/**
 * The source-anchored projection between Typst text and the Visual view's
 * ProseMirror document.
 *
 *   project(text, schema) → doc    every node remembers the source it came from
 *   print(doc)            → text   untouched nodes print their original source
 *                                  byte for byte; only edited ones are re-printed
 *   sourceToPos(doc, offset) / posToSource(doc, pos)
 *                                  map between source offsets and document
 *                                  positions, down to the character
 *   syncDoc(tr, target)   → tr     turns the current doc into a fresh projection
 *                                  with the smallest possible replacement
 *
 * Hence `print(project(text)) === text` for any input, and an edit in the
 * Visual view changes only the source of what it touched. Constructs the
 * Visual view does not model become `rawBlock` / `rawInline` atoms holding
 * their verbatim source.
 */
import type { SyntaxNode } from '@lezer/common';
import type { Mark, Node, Schema } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { typstParser } from 'codemirror-lang-typst/lezer';

/**
 * Nodes created by `project` and not modified since. ProseMirror nodes are
 * immutable and unchanged nodes keep their identity across transactions, so
 * membership means "the node still corresponds exactly to its `src`".
 * Textblocks also remember how their `src` lines up with their content.
 */
const pristine = new WeakMap<Node, InlineLayout | null>();

export function project(source: string, schema: Schema): Node {
  const ctx: Context = { schema, source };
  const segments = segment(children(typstParser.parse(source).topNode));
  if (segments.length === 0) {
    return schema.nodes.doc.create({ lead: source, trail: '' }, [textblock(ctx, { type: 'paragraph', attrs: { src: '' } }, 0, [])]);
  }
  const blocks = groupLists(ctx, segments.map((s, i) => toBlock(ctx, s, sepAfter(segments, i, source))));
  return schema.nodes.doc.create(
    { lead: source.slice(0, segments[0].from), trail: source.slice(segments.at(-1)!.to) },
    blocks,
  );
}

export function print(doc: Node): string {
  return printed(doc).text;
}

/**
 * The document position showing the source character at `offset`. Hidden
 * syntax (delimiters, markers, separators) maps to the next visible position
 * in its block; the inside of an atom to the position before the atom.
 *
 * With `bias` -1, `offset` is the end of a range and maps to the position
 * just after the visible character before it.
 */
export function sourceToPos(doc: Node, offset: number, bias: 1 | -1 = 1): number {
  const { spans, end } = printed(doc);
  if (bias < 0 && offset > 0) {
    const span = spans[firstIndex(spans, (s) => s.to >= offset)];
    if (span) return span.kind === 'text' ? span.pmFrom + offset - span.from : span.pmTo;
  }
  const span = spans[firstIndex(spans, (s) => s.to > offset)];
  if (!span) return end;
  return span.kind === 'text' ? span.pmFrom + Math.max(0, offset - span.from) : span.pmFrom;
}

/**
 * The source offset of the character after document position `pos`; at the
 * end of a block or between blocks, the offset just after the preceding
 * visible source.
 */
export function posToSource(doc: Node, pos: number): number {
  const { spans } = printed(doc);
  const index = firstIndex(spans, (s) => s.pmTo > pos);
  const span = spans[index];
  if (span && span.kind !== 'syntax' && span.pmFrom <= pos) {
    return span.kind === 'text' ? span.from + pos - span.pmFrom : span.from;
  }
  return gapSource(spans, index, pos);
}

/** For `pos` between visible spans, before `spans[index]`: the end of the visible source ending right there, or of the syntax up to it. */
function gapSource(spans: Span[], index: number, pos: number): number {
  let before = index - 1;
  while (before >= 0 && spans[before].kind === 'syntax' && spans[before].pmTo === pos) before--;
  if (before >= 0 && spans[before].pmTo === pos) return spans[before].to;
  return index > 0 ? spans[index - 1].to : 0;
}

// ---------------------------------------------------------------- projecting

interface Context {
  schema: Schema;
  source: string;
}

type SegmentKind = 'heading' | 'bullet' | 'ordered' | 'run';

/** A top-level stretch of source that becomes one block (or one list item). */
interface Segment {
  kind: SegmentKind;
  nodes: SyntaxNode[];
  from: number;
  to: number;
}

/** Syntax that makes a run of inline content a paragraph rather than a raw block. */
const PROSE = new Set(['Text', 'Strong', 'Emph', 'Escape', 'Shorthand', 'SmartQuote', 'Linebreak']);
const SHORTHANDS: Record<string, string> = {
  '~': '\u00a0',
  '--': '\u2013',
  '---': '\u2014',
  '-?': '\u00ad',
  '...': '\u2026',
};
const ORDERED_MARKER = /^\d|^\+/;

function children(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}

/** Splits markup into blocks: headings and list items stand alone, the rest forms runs up to a paragraph break. */
function segment(nodes: SyntaxNode[]): Segment[] {
  const segments: Segment[] = [];
  let run: SyntaxNode[] = [];
  const flushRun = () => {
    while (run.length > 0 && run.at(-1)!.name === 'Space') run.pop();
    if (run.length > 0) segments.push({ kind: 'run', nodes: run, from: run[0].from, to: run.at(-1)!.to });
    run = [];
  };
  for (const node of nodes) {
    const kind = blockKind(node);
    if (kind) {
      flushRun();
      segments.push({ kind, nodes: [node], from: node.from, to: node.to });
    } else if (node.name === 'Parbreak') {
      flushRun();
    } else if (node.name !== 'Space' || run.length > 0) {
      run.push(node);
    }
  }
  flushRun();
  return segments;
}

const BLOCK_KINDS: Record<string, SegmentKind> = { Heading: 'heading', ListItem: 'bullet', EnumItem: 'ordered' };

function blockKind(node: SyntaxNode): SegmentKind | null {
  return BLOCK_KINDS[node.name] ?? null;
}

function sepAfter(segments: Segment[], index: number, source: string): string | null {
  const next = segments[index + 1];
  return next ? source.slice(segments[index].to, next.from) : null;
}

function toBlock(ctx: Context, segment: Segment, sep: string | null): Node {
  const [node] = segment.nodes;
  const src = ctx.source.slice(segment.from, segment.to);
  switch (segment.kind) {
    case 'heading': {
      const level = Math.min(6, (node.getChild('HeadingMarker')?.to ?? node.from + 1) - node.from);
      const markup = node.getChild('Markup');
      return textblock(ctx, { type: 'heading', attrs: { level, src, sep } }, segment.from, markup ? inline(ctx, children(markup)) : []);
    }
    case 'bullet':
    case 'ordered':
      return listItem(ctx, node, sep);
    case 'run':
      return segment.nodes.some((n) => PROSE.has(n.name))
        ? textblock(ctx, { type: 'paragraph', attrs: { src, sep } }, segment.from, inline(ctx, segment.nodes))
        : ctx.schema.nodes.rawBlock.create({ src, sep });
  }
}

function listItem(ctx: Context, node: SyntaxNode, sep: string | null): Node {
  const marker = node.firstChild!;
  const markup = node.getChild('Markup');
  const body = markup ? children(markup) : [];
  const bodySrc = markup ? ctx.source.slice(markup.from, markup.to) : '';
  const nested = body.some((n) => n.name === 'Parbreak' || blockKind(n) !== null);
  const content = nested
    ? ctx.schema.nodes.rawBlock.create({ src: bodySrc })
    : textblock(ctx, { type: 'paragraph', attrs: { src: bodySrc } }, markup?.from ?? 0, inline(ctx, body));
  return pristineNode(
    ctx,
    'listItem',
    { marker: ctx.source.slice(marker.from, marker.to), src: ctx.source.slice(node.from, node.to), sep },
    [content],
  );
}

/** Wraps consecutive list items of the same kind into one list; the last item's separator moves to the list. */
function groupLists(ctx: Context, blocks: Node[]): Node[] {
  const result: Node[] = [];
  let items: Node[] = [];
  const flush = () => {
    if (items.length === 0) return;
    const last = items.at(-1)!;
    const listType = isOrdered(items[0]) ? ctx.schema.nodes.orderedList : ctx.schema.nodes.bulletList;
    items[items.length - 1] = pristineNode(ctx, 'listItem', { ...last.attrs, sep: null }, last.content);
    result.push(listType.create({ sep: last.attrs.sep }, items));
    items = [];
  };
  for (const block of blocks) {
    const isItem = block.type.name === 'listItem';
    if (!isItem || (items.length > 0 && isOrdered(items[0]) !== isOrdered(block))) flush();
    if (isItem) items.push(block);
    else result.push(block);
  }
  flush();
  return result;
}

function isOrdered(item: Node): boolean {
  return ORDERED_MARKER.test(item.attrs.marker ?? '');
}

/** An inline node and the source range it shows; source between placed nodes is hidden syntax. */
interface Placed {
  node: Node;
  from: number;
  to: number;
}

function inline(ctx: Context, nodes: SyntaxNode[], marks: readonly Mark[] = []): Placed[] {
  const result: Placed[] = [];
  let pos = nodes[0]?.from ?? 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.from > pos) result.push({ node: raw(ctx, ctx.source.slice(pos, node.from), marks), from: pos, to: node.from });
    // `#` and the expression after it form one piece of code
    const end = node.name === 'Hash' && nodes[i + 1]?.from === node.to ? nodes[++i].to : node.to;
    const projected = inlineNode({ ctx, node, src: ctx.source.slice(node.from, end), marks });
    result.push(...(Array.isArray(projected) ? projected : [{ node: projected, from: node.from, to: end }]));
    pos = end;
  }
  return result;
}

interface InlineContext {
  ctx: Context;
  node: SyntaxNode;
  src: string;
  marks: readonly Mark[];
}

/** Projects one piece of inline syntax: a node showing all of its source, or (for marks) the placed content. */
const INLINE: Record<string, (c: InlineContext) => Node | Placed[]> = {
  Text: (c) => c.ctx.schema.text(c.src, c.marks),
  SmartQuote: (c) => c.ctx.schema.text(c.src, c.marks),
  Space: (c) => (c.src.includes('\n') ? c.ctx.schema.nodes.softBreak.create({ src: c.src }) : c.ctx.schema.text(c.src, c.marks)),
  Linebreak: (c) => c.ctx.schema.nodes.hardBreak.create({ src: c.src }),
  Escape: (c) => sourceText(c, decodeEscape(c.src)),
  Shorthand: (c) => (c.src in SHORTHANDS ? sourceText(c, SHORTHANDS[c.src]) : raw(c.ctx, c.src, c.marks)),
  Strong: (c) => delimited(c, 'bold') ?? raw(c.ctx, c.src, c.marks),
  Emph: (c) => delimited(c, 'italic') ?? raw(c.ctx, c.src, c.marks),
};

function inlineNode(context: InlineContext): Node | Placed[] {
  return (INLINE[context.node.name] ?? ((c: InlineContext) => raw(c.ctx, c.src, c.marks)))(context);
}

/** `*…*` / `_…_` with both delimiters present; null for unclosed (erroneous) ones. */
function delimited({ ctx, node, marks }: InlineContext, markName: 'bold' | 'italic'): Placed[] | null {
  const parts = children(node);
  const markup = node.getChild('Markup');
  if (parts.length !== 3 || !markup || parts[2].name !== parts[0].name) return null;
  return inline(ctx, children(markup), ctx.schema.marks[markName].create().addToSet(marks));
}

function sourceText({ ctx, src, marks }: InlineContext, text: string): Node {
  return ctx.schema.text(text, ctx.schema.marks.typstSource.create({ src, text }).addToSet(marks));
}

function decodeEscape(src: string): string {
  const unicode = /^\\u\{([0-9a-fA-F]+)\}$/.exec(src);
  return unicode ? String.fromCodePoint(parseInt(unicode[1], 16)) : src.slice(1);
}

function raw(ctx: Context, src: string, marks: readonly Mark[]): Node {
  return ctx.schema.nodes.rawInline.create({ src }, null, marks);
}

function pristineNode(ctx: Context, type: string, attrs: Record<string, unknown>, content?: Node[] | Node['content']): Node {
  const node = ctx.schema.nodes[type].create(attrs, content);
  pristine.set(node, null);
  return node;
}

/** A pristine textblock whose `attrs.src` starts at source offset `from`. */
function textblock(
  ctx: Context,
  { type, attrs }: { type: string; attrs: { src: string } & Record<string, unknown> },
  from: number,
  content: Placed[],
): Node {
  const node = ctx.schema.nodes[type].create(attrs, content.map((p) => p.node));
  pristine.set(node, layout(content, from, from + attrs.src.length));
  return node;
}

/** How a pristine textblock's `src` lines up with its content: visible runs, with hidden syntax before each. */
interface InlineLayout {
  runs: { hidden: number; length: number; size: number; kind: 'text' | 'atom' }[];
  /** Hidden syntax after the last run. */
  tail: number;
}

function layout(content: Placed[], from: number, to: number): InlineLayout {
  let cursor = from;
  const runs = content.map(({ node, from: start, to: end }) => {
    const run = { hidden: start - cursor, length: end - start, size: node.nodeSize, kind: textKind(node, end - start) };
    cursor = end;
    return run;
  });
  return { runs, tail: to - cursor };
}

/** Text shows its source character by character unless it is decoded (an escape or shorthand). */
function textKind(node: Node, length: number): 'text' | 'atom' {
  const plain = node.isText && node.text!.length === length && !node.marks.some((m) => m.type.name === 'typstSource');
  return plain ? 'text' : 'atom';
}

// ------------------------------------------------------------------ printing

/** A stretch of printed source and the document range showing it (empty for hidden syntax). */
interface Span {
  from: number;
  to: number;
  pmFrom: number;
  pmTo: number;
  /** text: one character per position; atom: shown as a whole; syntax: hidden. */
  kind: 'text' | 'atom' | 'syntax';
}

interface Printed {
  text: string;
  /** Tile the text in order; their document ranges are in order, too. */
  spans: Span[];
  /** The last visible position, where source after it maps. */
  end: number;
}

/** Docs are immutable, so their printed form is cached. */
const printedDocs = new WeakMap<Node, Printed>();

function printed(doc: Node): Printed {
  let result = printedDocs.get(doc);
  if (!result) {
    const printer = new Printer();
    printer.hidden(doc.attrs.lead);
    printBlocks(printer, doc, 0, '\n\n');
    printer.hidden(doc.attrs.trail);
    result = printer.finish();
    printedDocs.set(doc, result);
  }
  return result;
}

/** Accumulates source text together with the document positions each part of it belongs to. */
class Printer {
  private text = '';
  private readonly spans: Span[] = [];
  /** Hidden syntax waiting for the next visible position. */
  private pending: Span[] = [];
  private end = 0;
  private indent = '';

  /** Source not shown in the document; it maps to the next visible position in its block. */
  hidden(src: string): void {
    const span = this.write(src, 'syntax', 0, 0);
    if (span) this.pending.push(span);
  }

  /** Source shown by the document range `pmFrom`..`pmTo`. */
  shown(src: string, kind: 'text' | 'atom', pmFrom: number, pmTo: number): void {
    this.settle(pmFrom);
    this.write(src, kind, pmFrom, pmTo);
    this.end = pmTo;
  }

  /** Closes a textblock whose content ends at `pos`: its trailing syntax maps there. */
  endBlock(pos: number): void {
    this.settle(pos);
    this.end = pos;
  }

  /** Prints with every line of the output indented by two more spaces. */
  indented(print: () => void): void {
    const outer = this.indent;
    this.indent += '  ';
    this.hidden('  ');
    print();
    this.indent = outer;
  }

  finish(): Printed {
    this.settle(this.end);
    return { text: this.text, spans: this.spans, end: this.end };
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

/** The first index whose span satisfies `test`, which is monotonic over the spans; `spans.length` if none. */
function firstIndex(spans: Span[], test: (span: Span) => boolean): number {
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (test(spans[mid])) high = mid;
    else low = mid + 1;
  }
  return low;
}

/** Prints the children of `container`, whose content starts at document position `start`. */
function printBlocks(out: Printer, container: Node, start: number, defaultSep: string): void {
  container.forEach((child, offset, index) => {
    printBlock(out, child, container, start + offset);
    if (index < container.childCount - 1) out.hidden(child.attrs.sep ?? defaultSep);
  });
}

/** Prints `node`, which starts at document position `pos`. */
function printBlock(out: Printer, node: Node, parent: Node, pos: number): void {
  const pristineLayout = pristine.get(node);
  if (pristineLayout) return printLayout(out, node, pristineLayout, pos + 1);
  if (pristine.has(node)) return printPristineItem(out, node, pos);
  switch (node.type.name) {
    case 'heading':
      out.hidden(`${'='.repeat(node.attrs.level)} `);
      return printTextblock(out, node, pos);
    case 'bulletList':
    case 'orderedList':
      return printBlocks(out, node, pos + 1, '\n');
    case 'listItem':
      return printListItem(out, node, parent, pos);
    case 'rawBlock':
      return out.shown(node.attrs.src, 'atom', pos, pos + 1);
    default:
      return printTextblock(out, node, pos);
  }
}

/** A pristine textblock: its `src`, with the content positions its layout assigns. */
function printLayout(out: Printer, block: Node, { runs, tail }: InlineLayout, start: number): void {
  const src: string = block.attrs.src;
  let from = 0;
  let pos = start;
  for (const run of runs) {
    out.hidden(src.slice(from, from + run.hidden));
    from += run.hidden;
    out.shown(src.slice(from, from + run.length), run.kind, pos, pos + run.size);
    from += run.length;
    pos += run.size;
  }
  out.hidden(src.slice(from, from + tail));
  out.endBlock(pos);
}

/** A pristine list item: its marker, then its only child, which is pristine, too. */
function printPristineItem(out: Printer, item: Node, pos: number): void {
  const src: string = item.attrs.src;
  const body: string = item.firstChild?.attrs.src ?? '';
  if (item.childCount !== 1 || !src.endsWith(body)) return out.shown(src, 'atom', pos, pos + item.nodeSize);
  out.hidden(src.slice(0, src.length - body.length));
  printBlock(out, item.firstChild!, item, pos + 1);
}

function printTextblock(out: Printer, block: Node, pos: number): void {
  printInline(out, block, pos + 1);
  out.endBlock(pos + block.nodeSize - 1);
}

/** `- body`, with further children (e.g. a nested list) on following lines, indented. */
function printListItem(out: Printer, item: Node, list: Node, pos: number): void {
  const ordered = list.type.name === 'orderedList';
  const keepMarker = item.attrs.marker !== null && ORDERED_MARKER.test(item.attrs.marker) === ordered;
  out.hidden(`${keepMarker ? item.attrs.marker : ordered ? '+' : '-'} `);
  item.forEach((child, offset, index) => {
    if (index === 0) return printBlock(out, child, item, pos + 1 + offset);
    out.hidden('\n');
    out.indented(() => printBlock(out, child, item, pos + 1 + offset));
  });
}

/** Typst syntax per formatting mark: delimiter and function name. */
const FORMATTING: Record<string, { delimiter: string; func: string }> = {
  bold: { delimiter: '*', func: 'strong' },
  italic: { delimiter: '_', func: 'emph' },
};
const FORMATTING_ORDER = Object.keys(FORMATTING);

interface Piece {
  marks: string[];
  text: string;
  /** The printed text is `node`'s text, escaped. */
  escaped: boolean;
  node: Node;
  pos: number;
}

/** Prints inline content, choosing `*x*` or `#strong[x]` per span so the result parses back the same. */
function printInline(out: Printer, block: Node, start: number): void {
  const pieces = inlinePieces(block, start);
  const open: { mark: string; close: string }[] = [];
  let printedSoFar = '';
  const hidden = (syntax: string) => {
    printedSoFar += syntax;
    out.hidden(syntax);
  };
  pieces.forEach((piece, i) => {
    let common = 0;
    while (common < open.length && piece.marks[common] === open[common].mark) common++;
    while (open.length > common) hidden(open.pop()!.close);
    for (const mark of piece.marks.slice(common)) {
      const end = spanEnd(pieces, i, mark);
      const syntax = FORMATTING[mark];
      const asFunction = needsFunctionSyntax(printedSoFar.at(-1), pieces[end + 1]?.text[0], piece.text, pieces[end].text);
      hidden(asFunction ? `#${syntax.func}[` : syntax.delimiter);
      open.push({ mark, close: asFunction ? ']' : syntax.delimiter });
    }
    printedSoFar += piece.text;
    printPiece(out, piece);
  });
  while (open.length > 0) hidden(open.pop()!.close);
}

function inlinePieces(block: Node, start: number): Piece[] {
  const pieces: Piece[] = [];
  let lineStart = true;
  block.forEach((child, offset) => {
    const original = child.isText ? originalSource(child) : (child.attrs.src as string);
    const text = original ?? escapeMarkup(child.text!.replace(/\n/g, ' '), lineStart);
    const names = new Set(child.marks.map((m) => m.type.name));
    pieces.push({ marks: FORMATTING_ORDER.filter((m) => names.has(m)), text, escaped: original === null, node: child, pos: start + offset });
    lineStart = /\n\s*$/.test(text);
  });
  return pieces;
}

/** Escaped text shows one character per position; the inserted backslashes are hidden. */
function printPiece(out: Printer, { text, escaped, node, pos }: Piece): void {
  if (!escaped) return out.shown(text, 'atom', pos, pos + node.nodeSize);
  let at = pos;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && i + 1 < text.length) out.hidden(text[i++]);
    out.shown(text[i], 'text', at, ++at);
  }
}

function spanEnd(pieces: Piece[], start: number, mark: string): number {
  let end = start;
  while (end + 1 < pieces.length && pieces[end + 1].marks.includes(mark)) end++;
  return end;
}

const WORD = /[\p{L}\p{N}_]/u;

function needsFunctionSyntax(before: string | undefined, after: string | undefined, first: string, last: string): boolean {
  return (before !== undefined && WORD.test(before)) || (after !== undefined && WORD.test(after)) || /^\s/.test(first) || /\s$/.test(last);
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

// ------------------------------------------------------------ synchronising

/**
 * Turns `tr.doc` into `target` (a fresh projection of the current text) with
 * the smallest replacement: ProseMirror's diff descends into equal-typed
 * nodes, so a changed word inside a paragraph replaces just that text and a
 * cursor elsewhere in the paragraph stays put. Attributes (`src`, `sep`) are
 * then updated in place and the result is marked pristine again.
 */
export function syncDoc(tr: Transaction, target: Node): Transaction {
  for (const attr of ['lead', 'trail']) {
    if (tr.doc.attrs[attr] !== target.attrs[attr]) tr.setDocAttribute(attr, target.attrs[attr]);
  }
  // Diff without the anchoring attributes: a block whose `src` changed must
  // still be descended into, not replaced wholesale. Sizes are unaffected.
  const current = withoutAnchors(tr.doc).content;
  const wanted = withoutAnchors(target).content;
  const start = current.findDiffStart(wanted);
  if (start !== null) {
    let { a: endA, b: endB } = current.findDiffEnd(wanted)!;
    const overlap = start - Math.min(endA, endB);
    if (overlap > 0) {
      endA += overlap;
      endB += overlap;
    }
    tr.replace(start, endA, target.slice(start, endB));
  }
  copyAttrs(tr, target);
  markPristine(tr.doc, target);
  printedDocs.delete(tr.doc);
  return tr;
}

const ANCHORS = ['src', 'sep', 'marker', 'lead', 'trail'];

function withoutAnchors(node: Node): Node {
  if (node.isText) return node;
  const attrs = { ...node.attrs };
  for (const key of ANCHORS) if (key in attrs) attrs[key] = null;
  const content: Node[] = [];
  node.forEach((child) => content.push(withoutAnchors(child)));
  return node.type.create(attrs, content, node.marks);
}

/** Updates node attributes that differ from `target` (structure is already equal). */
function copyAttrs(tr: Transaction, target: Node): void {
  tr.doc.descendants((node, pos) => {
    const other = target.nodeAt(pos);
    if (other && other.type === node.type && !node.hasMarkup(other.type, other.attrs, node.marks)) {
      tr.setNodeMarkup(pos, undefined, other.attrs);
    }
  });
}

function markPristine(node: Node, target: Node): void {
  if (pristine.has(target)) pristine.set(node, pristine.get(target)!);
  if (node.childCount !== target.childCount) return;
  node.forEach((child, _offset, index) => markPristine(child, target.child(index)));
}
