/**
 * The source-anchored projection between Typst text and the Visual view's
 * ProseMirror document.
 *
 *   project(text, schema) → doc    every node remembers the source it came from
 *   print(doc)            → text   untouched nodes print their original source
 *                                  byte for byte; only edited ones are re-printed
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
 */
const pristine = new WeakSet<Node>();

export function project(source: string, schema: Schema): Node {
  const ctx: Context = { schema, source };
  const segments = segment(children(typstParser.parse(source).topNode));
  if (segments.length === 0) {
    return schema.nodes.doc.create({ lead: source, trail: '' }, [pristineNode(ctx, 'paragraph', { src: '' })]);
  }
  const blocks = groupLists(ctx, segments.map((s, i) => toBlock(ctx, s, sepAfter(segments, i, source))));
  return schema.nodes.doc.create(
    { lead: source.slice(0, segments[0].from), trail: source.slice(segments.at(-1)!.to) },
    blocks,
  );
}

export function print(doc: Node): string {
  return doc.attrs.lead + printBlocks(doc, '\n\n') + doc.attrs.trail;
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
      return pristineNode(ctx, 'heading', { level, src, sep }, markup ? inline(ctx, children(markup)) : []);
    }
    case 'bullet':
    case 'ordered':
      return listItem(ctx, node, sep);
    case 'run':
      return segment.nodes.some((n) => PROSE.has(n.name))
        ? pristineNode(ctx, 'paragraph', { src, sep }, inline(ctx, segment.nodes))
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
    : pristineNode(ctx, 'paragraph', { src: bodySrc }, inline(ctx, body));
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

function inline(ctx: Context, nodes: SyntaxNode[], marks: readonly Mark[] = []): Node[] {
  const result: Node[] = [];
  let pos = nodes[0]?.from ?? 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.from > pos) result.push(raw(ctx, ctx.source.slice(pos, node.from), marks));
    // `#` and the expression after it form one piece of code
    const end = node.name === 'Hash' && nodes[i + 1]?.from === node.to ? nodes[++i].to : node.to;
    result.push(...inlineNode({ ctx, node, src: ctx.source.slice(node.from, end), marks }));
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

const INLINE: Record<string, (c: InlineContext) => Node[]> = {
  Text: (c) => [c.ctx.schema.text(c.src, c.marks)],
  SmartQuote: (c) => [c.ctx.schema.text(c.src, c.marks)],
  Space: (c) => [c.src.includes('\n') ? c.ctx.schema.nodes.softBreak.create({ src: c.src }) : c.ctx.schema.text(c.src, c.marks)],
  Linebreak: (c) => [c.ctx.schema.nodes.hardBreak.create({ src: c.src })],
  Escape: (c) => [sourceText(c, decodeEscape(c.src))],
  Shorthand: (c) => (c.src in SHORTHANDS ? [sourceText(c, SHORTHANDS[c.src])] : [raw(c.ctx, c.src, c.marks)]),
  Strong: (c) => delimited(c, 'bold') ?? [raw(c.ctx, c.src, c.marks)],
  Emph: (c) => delimited(c, 'italic') ?? [raw(c.ctx, c.src, c.marks)],
};

function inlineNode(context: InlineContext): Node[] {
  return (INLINE[context.node.name] ?? ((c: InlineContext) => [raw(c.ctx, c.src, c.marks)]))(context);
}

/** `*…*` / `_…_` with both delimiters present; null for unclosed (erroneous) ones. */
function delimited({ ctx, node, marks }: InlineContext, markName: 'bold' | 'italic'): Node[] | null {
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
  pristine.add(node);
  return node;
}

// ------------------------------------------------------------------ printing

function printBlocks(container: Node, defaultSep: string): string {
  let out = '';
  container.forEach((child, _offset, index) => {
    out += printBlock(child, container);
    if (index < container.childCount - 1) out += child.attrs.sep ?? defaultSep;
  });
  return out;
}

function printBlock(node: Node, parent: Node): string {
  if (pristine.has(node)) return node.attrs.src;
  switch (node.type.name) {
    case 'heading':
      return `${'='.repeat(node.attrs.level)} ${printInline(node)}`;
    case 'bulletList':
    case 'orderedList':
      return printBlocks(node, '\n');
    case 'listItem':
      return printListItem(node, parent);
    case 'rawBlock':
      return node.attrs.src;
    default:
      return printInline(node);
  }
}

/** `- body`, with further children (e.g. a nested list) on following lines, indented. */
function printListItem(item: Node, list: Node): string {
  const ordered = list.type.name === 'orderedList';
  const keepMarker = item.attrs.marker !== null && ORDERED_MARKER.test(item.attrs.marker) === ordered;
  const marker = keepMarker ? item.attrs.marker : ordered ? '+' : '-';
  let out = `${marker} ${printBlock(item.firstChild!, item)}`;
  item.forEach((child, _offset, index) => {
    if (index > 0) out += `\n${printBlock(child, item).replace(/^/gm, '  ')}`;
  });
  return out;
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
}

/** Prints inline content, choosing `*x*` or `#strong[x]` per span so the result parses back the same. */
function printInline(block: Node): string {
  const pieces = inlinePieces(block);
  const open: { mark: string; close: string }[] = [];
  let out = '';
  pieces.forEach((piece, i) => {
    let common = 0;
    while (common < open.length && piece.marks[common] === open[common].mark) common++;
    while (open.length > common) out += open.pop()!.close;
    for (const mark of piece.marks.slice(common)) {
      const end = spanEnd(pieces, i, mark);
      const syntax = FORMATTING[mark];
      const asFunction = needsFunctionSyntax(out.at(-1), pieces[end + 1]?.text[0], piece.text, pieces[end].text);
      out += asFunction ? `#${syntax.func}[` : syntax.delimiter;
      open.push({ mark, close: asFunction ? ']' : syntax.delimiter });
    }
    out += piece.text;
  });
  while (open.length > 0) out += open.pop()!.close;
  return out;
}

function inlinePieces(block: Node): Piece[] {
  const pieces: Piece[] = [];
  let lineStart = true;
  block.forEach((child) => {
    const text = child.isText ? printText(child, lineStart) : (child.attrs.src as string);
    const names = new Set(child.marks.map((m) => m.type.name));
    pieces.push({ marks: FORMATTING_ORDER.filter((m) => names.has(m)), text });
    lineStart = /\n\s*$/.test(text);
  });
  return pieces;
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

function printText(node: Node, lineStart: boolean): string {
  const original = node.marks.find((m) => m.type.name === 'typstSource');
  if (original && original.attrs.text === node.text) return original.attrs.src;
  return escapeMarkup(node.text!.replace(/\n/g, ' '), lineStart);
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
 * The document position just inside the top-level block whose source
 * contains `offset` (clamped to the first/last block).
 */
export function locate(doc: Node, offset: number): number {
  let source = doc.attrs.lead.length;
  let found = 1;
  doc.forEach((child, pos, index) => {
    if (source <= offset) found = pos + 1;
    source += printBlock(child, doc).length + (index < doc.childCount - 1 ? (child.attrs.sep ?? '\n\n').length : 0);
  });
  return found;
}

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
  if (pristine.has(target)) pristine.add(node);
  if (node.childCount !== target.childCount) return;
  node.forEach((child, _offset, index) => markPristine(child, target.child(index)));
}
