// Serializing the Visual view's document back to Typst (ProseMirrorToTypstSerializer): untouched nodes print their
// source, edited ones through their specs' toTypst; every stretch of output remembers the document range showing it
// (the position map). See projection.ts.
import type { Mark, Node } from '@tiptap/pm/model';
import { Grammar } from './grammar';
import type { Around, TypstSerializeState } from './projection';
import { labelSyntax } from './labels';
import { type InlineLayout, pristine } from './pristine';
import { markupSource } from '../../core/typst-syntax/typst-syntax';

/** A stretch of printed source and the document range showing it (empty for hidden syntax). */
export interface Span {
  from: number;
  to: number;
  pmFrom: number;
  pmTo: number;
  /** text: one character per position; atom: shown as a whole; syntax: hidden. */
  kind: 'text' | 'atom' | 'syntax';
}

/** A document's source and its position map. */
export interface Printed {
  text: string;
  /** Tile the text in order; their document ranges are in order, too. */
  spans: Span[];
  /** The last visible position, where source after it maps. */
  end: number;
}

/** Docs are immutable, so their printed form is cached. */
const printedDocs = new WeakMap<Node, Printed>();

/** `doc` printed, with its position map (cached). */
export function printed(doc: Node): Printed {
  let result = printedDocs.get(doc);
  if (!result) {
    const serializer = new ProseMirrorToTypstSerializer(Grammar.of(doc.type.schema));
    serializer.hidden(doc.attrs.lead);
    serializer.blocks(doc, 0, '\n\n');
    serializer.hidden(doc.attrs.trail);
    result = serializer.finish();
    printedDocs.set(doc, result);
  }
  return result;
}

/** Forgets the printed form of `doc` (its pristine nodes changed). */
export function forgetPrinted(doc: Node): void {
  printedDocs.delete(doc);
}

/**
 * Serializes a document: the `TypstSerializeState` the specs' toTypst functions write edited blocks through (its
 * members are documented there); accumulates source text with the positions showing it.
 */
class ProseMirrorToTypstSerializer implements TypstSerializeState {
  private text = '';
  private readonly spans: Span[] = [];
  /** Hidden syntax waiting for the next visible position. */
  private pending: Span[] = [];
  private end = 0;
  private indent = '';

  constructor(private readonly grammar: Grammar) {}

  hidden(src: string): void {
    const span = this.write(src, 'syntax', 0, 0);
    if (span) this.pending.push(span);
  }

  shown(src: string, kind: 'text' | 'atom', pmFrom: number, pmTo: number): void {
    this.settle(pmFrom);
    this.write(src, kind, pmFrom, pmTo);
    this.end = pmTo;
  }

  endBlock(pos: number, empty: boolean): void {
    this.settle(pos);
    this.end = pos;
    if (empty) this.spans.push({ from: this.text.length, to: this.text.length, pmFrom: pos, pmTo: pos, kind: 'text' });
  }

  closing(src: string): void {
    this.write(src, 'syntax', this.end, this.end);
  }

  after(src: string): void {
    if (this.pending.length > 0) this.hidden(src);
    else this.closing(src);
  }

  indented(print: () => void): void {
    const outer = this.indent;
    this.indent += '  ';
    this.hidden('  ');
    print();
    this.indent = outer;
  }

  blocks(container: Node, start: number, defaultSep: string): void {
    container.forEach((child, offset, index) => {
      this.block(child, container, start + offset);
      if (index < container.childCount - 1) this.hidden(child.attrs.sep ?? defaultSep);
    });
  }

  block(node: Node, parent: Node, pos: number): void {
    this.unlabelled(node, parent, pos);
    if (node.attrs.label) this.after(labelSyntax(node.attrs.label));
  }

  textblock(block: Node, pos: number): void {
    this.inline(block, pos + 1);
    this.endBlock(pos + block.nodeSize - 1, block.content.size === 0);
  }

  inline(block: Node, start: number): void {
    printInline(this, this.grammar, block, start);
  }

  item(item: Node, pos: number, prefix: string): void {
    this.hidden(prefix);
    item.forEach((child, offset, index) => {
      if (index === 0) return this.block(child, item, pos + 1 + offset);
      this.hidden('\n');
      this.indented(() => this.block(child, item, pos + 1 + offset));
    });
  }

  finish(): Printed {
    this.settle(this.end);
    return { text: this.text, spans: this.spans, end: this.end };
  }

  private unlabelled(node: Node, parent: Node, pos: number): void {
    const pristineLayout = pristine.get(node);
    if (pristineLayout) return this.layout(node, pristineLayout, pos + 1);
    if (pristine.has(node)) return this.pristineItem(node, pos);
    if (isSourceAtom(node)) return this.shown(node.attrs.src, 'atom', pos, pos + 1);
    const toTypst = this.grammar.node(node.type)?.typst?.toTypst;
    if (toTypst) toTypst(this, node, pos, parent);
    else this.textblock(node, pos);
  }

  /** A pristine textblock: its `src`, with the content positions its layout assigns. */
  private layout(block: Node, { runs, tail, closing }: InlineLayout, start: number): void {
    const src: string = block.attrs.src;
    let from = 0;
    let pos = start;
    for (const run of runs) {
      this.hidden(src.slice(from, from + run.hidden));
      from += run.hidden;
      this.shown(src.slice(from, from + run.length), run.kind, pos, pos + run.size);
      from += run.length;
      pos += run.size;
    }
    this.hidden(src.slice(from, from + tail));
    this.endBlock(pos, pos === start);
    this.closing(src.slice(from + tail, from + tail + closing));
  }

  /** A pristine list item: its marker, then its only child, which is pristine, too. */
  private pristineItem(item: Node, pos: number): void {
    const src: string = item.attrs.src;
    const body: string = item.firstChild?.attrs.src ?? '';
    if (item.childCount !== 1 || !src.endsWith(body)) return this.shown(src, 'atom', pos, pos + item.nodeSize);
    this.hidden(src.slice(0, src.length - body.length));
    this.block(item.firstChild!, item, pos + 1);
  }

  private settle(pos: number): void {
    for (const span of this.pending) span.pmFrom = span.pmTo = pos;
    this.pending = [];
  }

  private write(src: string, kind: Span['kind'], pmFrom: number, pmTo: number): Span | null {
    const text = this.indent ? src.replace(/\n/g, `\n${this.indent}`) : src;
    if (!text) return null;
    const from = this.text.length;
    this.text += text;
    const last = this.spans.at(-1);
    if (kind === 'text' && text.length === pmTo - pmFrom) {
      if (last?.kind === 'text' && last.pmTo === pmFrom) {
        last.to = this.text.length;
        last.pmTo = pmTo;
        return last;
      }
    } else if (kind === 'text') {
      kind = 'atom';
    }
    const span: Span = { from, to: this.text.length, pmFrom, pmTo, kind };
    this.spans.push(span);
    return span;
  }
}

/** A block shown as a whole and printed as its `src`: raw blocks, images, page breaks, rules. */
function isSourceAtom(node: Node): boolean {
  return node.isBlock && node.isAtom && typeof node.attrs.src === 'string';
}

// ------------------------------------------------------------ inline content

interface Piece {
  /** Formatting marks, in schema order. */
  marks: readonly Mark[];
  text: string;
  /** The printed text is `node`'s text, escaped. */
  escaped: boolean;
  /** The printed text is `node`'s text as is, inside raw text (inline code). */
  code: boolean;
  node: Node;
  pos: number;
}

/**
 * Prints inline content: each formatted span opens with its syntax (longer
 * spans outside), as its mark's spec prints it (`*x*` or `#strong[x]`, so the
 * result parses back the same; a link showing its own URL bare). Raw text
 * (inline code) holds no markup: it is always innermost, closed and reopened
 * around any other formatting change.
 */
function printInline(out: TypstSerializeState, grammar: Grammar, block: Node, start: number): void {
  const pieces = inlinePieces(grammar, block, start);
  const isRaw = (mark: Mark) => grammar.mark(mark.type.name)?.typst.raw === true;
  const open: { mark: Mark; close: string }[] = [];
  let printedSoFar = '';
  const hidden = (syntax: string) => {
    printedSoFar += syntax;
    out.hidden(syntax);
  };
  const closeFrom = (index: number) => {
    while (index >= 0 && open.length > index) hidden(open.pop()!.close);
  };
  pieces.forEach((piece, i) => {
    closeFrom(open.findIndex((o) => !o.mark.isInSet(piece.marks)));
    let text = piece.text;
    let opening = marksToOpen(pieces, i, open, isRaw);
    if (opening.length > 0 && open.length > 0 && isRaw(open.at(-1)!.mark)) {
      closeFrom(open.length - 1);
      opening = marksToOpen(pieces, i, open, isRaw);
    }
    opening.forEach(({ mark, end }, n) => {
      const { typst } = grammar.mark(mark.type.name)!;
      const spanText = pieces.slice(i, end + 1).map((p) => p.text).join('');
      const next = pieces[end + 1];
      const around: Around = { before: printedSoFar.at(-1), after: next?.code ? '`' : next?.text[0], first: piece.text, last: pieces[end].text, text: spanText };
      if (n === opening.length - 1 && end === i && piece.escaped && typst.isBare?.(mark, piece.node.text!, around)) {
        open.push({ mark, close: '' });
        text = piece.node.text!;
        return;
      }
      const syntax = typst.toTypst(mark, around);
      hidden(syntax.open);
      open.push({ mark, close: syntax.close });
    });
    text = guardCall(printedSoFar, text, piece.escaped);
    if (piece.escaped) text = escapeAfter(grammar, pieces[i - 1]?.node, text);
    printedSoFar += text;
    printPiece(out, piece, text);
  });
  while (open.length > 0) hidden(open.pop()!.close);
}

/**
 * The marks of `pieces[index]` not open yet, with the last piece they span;
 * longer spans first, raw text last (it spans only pieces formatted alike).
 */
function marksToOpen(pieces: Piece[], index: number, open: { mark: Mark }[], isRaw: (mark: Mark) => boolean): { mark: Mark; end: number }[] {
  const rawFirst = (mark: Mark) => Number(isRaw(mark));
  return pieces[index].marks
    .filter((mark) => !open.some((o) => o.mark.eq(mark)))
    .map((mark) => ({ mark, end: isRaw(mark) ? alikeEnd(pieces, index) : spanEnd(pieces, index, mark) }))
    .sort((a, b) => rawFirst(a.mark) - rawFirst(b.mark) || b.end - a.end);
}

/** The last piece of the run from `start` with the same formatting. */
function alikeEnd(pieces: Piece[], start: number): number {
  let end = start;
  while (end + 1 < pieces.length && sameMarks(pieces[end + 1].marks, pieces[start].marks)) end++;
  return end;
}

function sameMarks(a: readonly Mark[], b: readonly Mark[]): boolean {
  return a.length === b.length && a.every((mark, i) => mark.eq(b[i]));
}

function spanEnd(pieces: Piece[], start: number, mark: Mark): number {
  let end = start;
  while (end + 1 < pieces.length && mark.isInSet(pieces[end + 1].marks)) end++;
  return end;
}

/** `text` as the node printed before it needs it escaped (its spec's `escapeAfter`), if any. */
function escapeAfter(grammar: Grammar, previous: Node | undefined, text: string): string {
  if (!previous) return text;
  return grammar.node(previous.type)?.typst?.escapeAfter?.(previous, text) ?? text;
}

/** Text right after `]` would continue a function call if it starts with `(` or `.field`; escapes that. */
function guardCall(printedSoFar: string, text: string, escaped: boolean): string {
  return escaped && printedSoFar.endsWith(']') && /^(\(|\.\w)/.test(text) ? `\\${text}` : text;
}

function inlinePieces(grammar: Grammar, block: Node, start: number): Piece[] {
  const pieces: Piece[] = [];
  let lineStart = true;
  block.forEach((child, offset) => {
    // only text can be raw text; atoms keep their own source
    const marks = child.marks.filter((m) => {
      const spec = grammar.mark(m.type.name);
      return spec !== undefined && (child.isText || !spec.typst.raw);
    });
    const code = marks.some((m) => grammar.mark(m.type.name)!.typst.raw);
    const original = code ? null : child.isText ? originalSource(child) : atomSource(grammar, child);
    const plain = child.text?.replace(/\n/g, ' ') ?? '';
    const text = original ?? (code ? plain : escapeMarkup(plain, lineStart));
    pieces.push({ marks, text, escaped: original === null && !code, code, node: child, pos: start + offset });
    lineStart = /\n\s*$/.test(text);
  });
  return pieces;
}

/**
 * Prints `text`, which shows `node`: escaped text one character per position,
 * its escaping backslashes hidden; code likewise, with no escapes.
 */
function printPiece(out: TypstSerializeState, { escaped, code, node, pos }: Piece, text: string): void {
  if (code) return out.shown(text, 'text', pos, pos + node.nodeSize);
  if (!escaped) return out.shown(text, 'atom', pos, pos + node.nodeSize);
  let at = pos;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && i + 1 < text.length) out.hidden(text[i++]);
    out.shown(text[i], 'text', at, ++at);
  }
}

/** The source an inline atom prints: its spec's, else its `src` (code without `#` in markup form). */
function atomSource(grammar: Grammar, atom: Node): string {
  const own = grammar.node(atom.type)?.typst?.atomToTypst;
  if (own) return own(atom);
  return atom.attrs.code ? markupSource(atom.attrs.src) : atom.attrs.src;
}

/** How a decoded escape or shorthand was written, if its text is unchanged. */
function originalSource(node: Node): string | null {
  const original = node.marks.find((m) => m.type.name === 'typstSource');
  return original && original.attrs.text === node.text ? original.attrs.src : null;
}

/** Characters that would start markup anywhere: `*`, `#`, shorthands (`--`, `...`), comments (`//`), … */
const INLINE_HAZARD = /[\\*_#$@<[\]`~]|-(?=[-?\d])|\.(?=\.\.)|\/(?=[/*])/g;
/** Heading, list, enum and term markers, which only count at the start of a line. */
const LINE_START_MARKER = /^(=+|[-+/])(?=\s|$)/;
const ENUM_NUMBER = /^(\d+)\.(?=\s|$)/;

/** Escapes text so Typst reads it back as exactly this text. */
function escapeMarkup(text: string, lineStart: boolean): string {
  const escaped = text.replace(INLINE_HAZARD, (c) => `\\${c}`);
  if (!lineStart) return escaped;
  return escaped.replace(LINE_START_MARKER, '\\$1').replace(ENUM_NUMBER, '$1\\.');
}
