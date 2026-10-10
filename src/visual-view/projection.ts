/**
 * The source-anchored projection between Typst text and the Visual view's
 * ProseMirror document.
 *
 *   project(text)  → doc    every node remembers the source it came from
 *   print(doc)     → text   untouched nodes print their original source byte
 *                           for byte; only edited nodes are re-printed
 *
 * Hence `print(project(text)) === text` for any input, and an edit in the
 * Visual view changes only the source of the block it touched. Constructs the
 * Visual view does not model become `raw_block` / `raw_inline` atoms holding
 * their verbatim source.
 */
import type { SyntaxNode } from '@lezer/common';
import type { Mark, Node } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import { typstParser } from 'codemirror-lang-typst/lezer';
import { schema } from './schema';

/**
 * Nodes created by `project` and not modified since. ProseMirror nodes are
 * immutable and unchanged nodes keep their identity across transactions, so
 * membership means "the node still corresponds exactly to its `src`".
 */
const pristine = new WeakSet<Node>();

export function project(source: string): Node {
  const segments = segment(children(typstParser.parse(source).topNode));
  if (segments.length === 0) {
    return schema.nodes.doc.create({ lead: source, trail: '' }, [pristineNode('paragraph', { src: '' })]);
  }
  const blocks = groupLists(segments.map((s, i) => toBlock(s, source, sepAfter(segments, i, source))));
  return schema.nodes.doc.create(
    { lead: source.slice(0, segments[0].from), trail: source.slice(segments.at(-1)!.to) },
    blocks,
  );
}

export function print(doc: Node): string {
  return doc.attrs.lead + printBlocks(doc, '\n\n') + doc.attrs.trail;
}

// ---------------------------------------------------------------- projecting

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

function blockKind(node: SyntaxNode): SegmentKind | null {
  switch (node.name) {
    case 'Heading':
      return 'heading';
    case 'ListItem':
      return 'bullet';
    case 'EnumItem':
      return 'ordered';
    default:
      return null;
  }
}

function sepAfter(segments: Segment[], index: number, source: string): string | null {
  const next = segments[index + 1];
  return next ? source.slice(segments[index].to, next.from) : null;
}

function toBlock(segment: Segment, source: string, sep: string | null): Node {
  const [node] = segment.nodes;
  const src = source.slice(segment.from, segment.to);
  switch (segment.kind) {
    case 'heading': {
      const level = node.getChild('HeadingMarker')?.to! - node.from || 1;
      const markup = node.getChild('Markup');
      return pristineNode('heading', { level, src, sep }, markup ? inline(children(markup), source) : []);
    }
    case 'bullet':
    case 'ordered':
      return listItem(node, source, sep);
    case 'run':
      return segment.nodes.some((n) => PROSE.has(n.name))
        ? pristineNode('paragraph', { src, sep }, inline(segment.nodes, source))
        : schema.nodes.raw_block.create({ src, sep });
  }
}

function listItem(node: SyntaxNode, source: string, sep: string | null): Node {
  const marker = node.firstChild!;
  const markup = node.getChild('Markup');
  const body = markup ? children(markup) : [];
  const bodySrc = markup ? source.slice(markup.from, markup.to) : '';
  const nested = body.some((n) => n.name === 'Parbreak' || blockKind(n) !== null);
  const content = nested
    ? schema.nodes.raw_block.create({ src: bodySrc })
    : pristineNode('paragraph', { src: bodySrc }, inline(body, source));
  return pristineNode(
    'list_item',
    { marker: source.slice(marker.from, marker.to), src: source.slice(node.from, node.to), sep },
    [content],
  );
}

/** Wraps consecutive list items of the same kind into one list; the last item's separator moves to the list. */
function groupLists(blocks: Node[]): Node[] {
  const result: Node[] = [];
  let items: Node[] = [];
  const flush = () => {
    if (items.length === 0) return;
    const last = items.at(-1)!;
    const listType = /^\d|^\+/.test(items[0].attrs.marker) ? schema.nodes.ordered_list : schema.nodes.bullet_list;
    items[items.length - 1] = pristineNode('list_item', { ...last.attrs, sep: null }, last.content);
    result.push(listType.create({ sep: last.attrs.sep }, items));
    items = [];
  };
  for (const block of blocks) {
    const sameList = items.length > 0 && isOrdered(items[0]) === isOrdered(block);
    if (block.type !== schema.nodes.list_item || (items.length > 0 && !sameList)) flush();
    if (block.type === schema.nodes.list_item) items.push(block);
    else result.push(block);
  }
  flush();
  return result;
}

function isOrdered(item: Node): boolean {
  return item.type === schema.nodes.list_item && /^\d|^\+/.test(item.attrs.marker);
}

function inline(nodes: SyntaxNode[], source: string, marks: readonly Mark[] = []): Node[] {
  const result: Node[] = [];
  let pos = nodes[0]?.from ?? 0;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.from > pos) result.push(raw(source.slice(pos, node.from), marks));
    // `#` and the expression after it form one piece of code
    const end = node.name === 'Hash' && nodes[i + 1]?.from === node.to ? nodes[++i].to : node.to;
    result.push(...inlineNode({ node, src: source.slice(node.from, end), source, marks }));
    pos = end;
  }
  return result;
}

interface InlineContext {
  node: SyntaxNode;
  src: string;
  source: string;
  marks: readonly Mark[];
}

const INLINE: Record<string, (c: InlineContext) => Node[]> = {
  Text: (c) => [schema.text(c.src, c.marks)],
  SmartQuote: (c) => [schema.text(c.src, c.marks)],
  Space: (c) => [c.src.includes('\n') ? schema.nodes.soft_break.create({ src: c.src }) : schema.text(c.src, c.marks)],
  Linebreak: (c) => [schema.nodes.hard_break.create({ src: c.src })],
  Escape: (c) => [sourceText(decodeEscape(c.src), c.src, c.marks)],
  Shorthand: (c) => (c.src in SHORTHANDS ? [sourceText(SHORTHANDS[c.src], c.src, c.marks)] : [raw(c.src, c.marks)]),
  Strong: (c) => delimited(c.node, c.source, c.marks) ?? [raw(c.src, c.marks)],
  Emph: (c) => delimited(c.node, c.source, c.marks) ?? [raw(c.src, c.marks)],
};

function inlineNode(context: InlineContext): Node[] {
  return (INLINE[context.node.name] ?? ((c: InlineContext) => [raw(c.src, c.marks)]))(context);
}

/** `*…*` / `_…_` with both delimiters present; null for unclosed (erroneous) ones. */
function delimited(node: SyntaxNode, source: string, marks: readonly Mark[]): Node[] | null {
  const parts = children(node);
  const markup = node.getChild('Markup');
  if (parts.length !== 3 || !markup || parts[2].name !== parts[0].name) return null;
  const mark = node.name === 'Strong' ? schema.marks.strong.create() : schema.marks.emph.create();
  return inline(children(markup), source, mark.addToSet(marks));
}

function sourceText(text: string, src: string, marks: readonly Mark[]): Node {
  return schema.text(text, schema.marks.source.create({ src, text }).addToSet(marks));
}

function decodeEscape(src: string): string {
  const unicode = /^\\u\{([0-9a-fA-F]+)\}$/.exec(src);
  return unicode ? String.fromCodePoint(parseInt(unicode[1], 16)) : src.slice(1);
}

function raw(src: string, marks: readonly Mark[]): Node {
  return schema.nodes.raw_inline.create({ src }, null, marks);
}

function pristineNode(type: string, attrs: Record<string, unknown>, content?: Node[] | Node['content']): Node {
  const node = schema.nodes[type].create(attrs, content);
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
    case 'bullet_list':
    case 'ordered_list':
      return printBlocks(node, '\n');
    case 'list_item': {
      const marker = parent.type === schema.nodes.ordered_list && !/^\d|^\+/.test(node.attrs.marker) ? '+' : node.attrs.marker;
      return `${marker} ${printBlock(node.firstChild!, node)}`;
    }
    case 'raw_block':
      return node.attrs.src;
    default:
      return printInline(node);
  }
}

const FORMATTING = ['strong', 'emph'] as const;
type Formatting = (typeof FORMATTING)[number];
const DELIMITER: Record<Formatting, string> = { strong: '*', emph: '_' };

interface Piece {
  marks: Formatting[];
  text: string;
}

/** Prints inline content, choosing `*x*` or `#strong[x]` per span so the result parses back the same. */
function printInline(block: Node): string {
  const pieces = inlinePieces(block);
  const open: { mark: Formatting; close: string }[] = [];
  let out = '';
  pieces.forEach((piece, i) => {
    let common = 0;
    while (common < open.length && piece.marks[common] === open[common].mark) common++;
    while (open.length > common) out += open.pop()!.close;
    for (const mark of piece.marks.slice(common)) {
      const end = spanEnd(pieces, i, mark);
      const asFunction = needsFunctionSyntax(out.at(-1), pieces[end + 1]?.text[0], piece.text, pieces[end].text);
      out += asFunction ? `#${mark}[` : DELIMITER[mark];
      open.push({ mark, close: asFunction ? ']' : DELIMITER[mark] });
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
    pieces.push({ marks: FORMATTING.filter((m) => schema.marks[m].isInSet(child.marks)), text });
    lineStart = !child.isText && text.endsWith('\n') ? true : /\n\s*$/.test(text);
  });
  return pieces;
}

function spanEnd(pieces: Piece[], start: number, mark: Formatting): number {
  let end = start;
  while (end + 1 < pieces.length && pieces[end + 1].marks.includes(mark)) end++;
  return end;
}

const WORD = /[\p{L}\p{N}_]/u;

function needsFunctionSyntax(before: string | undefined, after: string | undefined, first: string, last: string): boolean {
  return (before !== undefined && WORD.test(before)) || (after !== undefined && WORD.test(after)) || /^\s/.test(first) || /\s$/.test(last);
}

function printText(node: Node, lineStart: boolean): string {
  const original = schema.marks.source.isInSet(node.marks);
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
 * Turns `tr.doc` into `target` (a fresh projection) by replacing only the
 * top-level blocks that differ, so untouched blocks keep their identity —
 * and with it their selection, decorations and pristine state.
 */
export function syncBlocks(tr: Transaction, target: Node): Transaction {
  for (const attr of ['lead', 'trail']) {
    if (tr.doc.attrs[attr] !== target.attrs[attr]) tr.setDocAttribute(attr, target.attrs[attr]);
  }
  const range = differingChildren(tr.doc, target);
  if (!range) return tr;
  const blocks: Node[] = [];
  for (let i = range.start; i < range.endTarget; i++) blocks.push(target.child(i));
  return tr.replaceWith(childOffset(tr.doc, range.start), childOffset(tr.doc, range.endCurrent), blocks);
}

/** The child index range that differs between two docs, after trimming equal children at both ends. */
function differingChildren(current: Node, target: Node) {
  const min = Math.min(current.childCount, target.childCount);
  let start = 0;
  while (start < min && current.child(start).eq(target.child(start))) start++;
  let endCurrent = current.childCount;
  let endTarget = target.childCount;
  while (endCurrent > start && endTarget > start && current.child(endCurrent - 1).eq(target.child(endTarget - 1))) {
    endCurrent--;
    endTarget--;
  }
  return start === endCurrent && start === endTarget ? null : { start, endCurrent, endTarget };
}

function childOffset(parent: Node, index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i++) offset += parent.child(i).nodeSize;
  return offset;
}
