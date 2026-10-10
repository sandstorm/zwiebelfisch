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
 *
 * Besides markup (headings, lists, paragraphs, strong/emph), it models links
 * (`#link("url")[text]`, bare URLs) as a `link` mark, raw text as code blocks
 * (```lang …```) and a `code` mark (`code`), standalone `#image("path", ..)`
 * and `#outline(..)` calls as `image` / `outline` blocks (source kept like a
 * raw block), `#figure(image("path", ..) | table(..), caption: [..])` as
 * figures whose caption is rich text, and `#table(columns: n, [..], ..)` as
 * tables whose cells hold blocks; a cell written as an expression (`ms(18)`)
 * is a code box of its own (see `embedded-code.ts`). Text alignment (see `text-align.ts`):
 * `#align(<alignment>)[..]` is an `alignment` block holding blocks,
 * `#par(justify: ..)[..]` a paragraph with its `justify` flag.
 * `drafting` margin notes become a `marginNote` atom
 * (`#margin-note(..)[note]`) or, for `#margin-note(..)[text][note]`, a
 * `noteRange` mark over the projected text that holds the call and the note.
 * Block nodes (see `call-atoms.ts`): `table.header(..)` rows as header
 * cells, `#quote(block: true)[..]` as block quotes, `- [ ]` / `- [x]` items as
 * task items, and `#pagebreak()` / full-width `#line(..)` as atoms.
 * Custom styles (see `features/styles/`): a call of a declared paragraph
 * style that is a block of its own (`#note[..]`, `#callout(..)[..]`) is a
 * `styledBlock` holding blocks; a text style call in running text
 * (`#key[..]`) is text with a `style` mark. Undeclared calls stay raw.
 * References (`@key`, `@key[supplement]`) are `reference` atoms; a label
 * (`<key>`) after a heading, or ending a block's run, is that block's `label`
 * attribute (see `labels.ts`).
 */
import type { SyntaxNode } from '@lezer/common';
import type { Mark, Node, Schema } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { typstParser } from 'codemirror-lang-typst/lezer';
import { codeBlockDelimiters, inlineCodeDelimiters, rawCode } from './raw-code';

export { codeLanguage } from './raw-code';
export { LABEL_CHAR, labelName } from './labels';
export { alignArgs, setRules, withHorizontal, type Horizontal, type TextAlignment } from './alignment';
import { alignArgs } from './alignment';
import { noteCallSyntax, printNoteCall, rangeNoteSyntax } from '../../comments/comments';
import { callAtomType } from './call-atoms';
import { type BlockLabel, guardAfterReference, labelSyntax, referenceSyntax, splitTrailingLabel, labelAfterHeading } from './labels';
import { isEmbeddable, markupSource } from './embedded-code';

/**
 * Nodes created by `project` and not modified since. ProseMirror nodes are
 * immutable and unchanged nodes keep their identity across transactions, so
 * membership means "the node still corresponds exactly to its `src`".
 * Textblocks also remember how their `src` lines up with their content.
 */
const pristine = new WeakMap<Node, InlineLayout | null>();

/** The styles the projection models, by function name (see `features/styles/`). */
export type ProjectedStyles = ReadonlyMap<string, { kind: 'paragraph' | 'text'; label: string }>;

const NO_STYLES: ProjectedStyles = new Map();

export function project(source: string, schema: Schema, styles: ProjectedStyles = NO_STYLES): Node {
  const ctx: Context = { schema, source, notes: 0, styles };
  const segments = segment(children(typstParser.parse(source).topNode));
  if (segments.length === 0) {
    return schema.nodes.doc.create({ lead: source, trail: '' }, [textblock(ctx, { type: 'paragraph', attrs: { src: '' } }, 0, [])]);
  }
  return schema.nodes.doc.create(
    { lead: source.slice(0, segments[0].from), trail: source.slice(end(segments.at(-1)!)) },
    blocks(ctx, segments),
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
 *
 * With `bias` -1, `pos` is the end of a range and maps to just after the
 * source of the visible character (or atom) before it.
 */
export function posToSource(doc: Node, pos: number, bias: 1 | -1 = 1): number {
  const { spans } = printed(doc);
  const end = bias < 0 ? endSource(spans, pos) : null;
  if (end !== null) return end;
  const index = firstIndex(spans, (s) => s.pmTo > pos);
  const span = spans[index];
  if (span && span.kind !== 'syntax' && span.pmFrom <= pos) {
    return span.kind === 'text' ? span.from + pos - span.pmFrom : span.from;
  }
  return gapSource(spans, index, pos);
}

/** The source end of the visible character or atom ending at `pos`, if there is one. */
function endSource(spans: Span[], pos: number): number | null {
  const span = spans[firstIndex(spans, (s) => s.pmTo >= pos)];
  if (!span || span.kind === 'syntax' || span.pmFrom >= pos) return null;
  return span.kind === 'text' ? span.from + pos - span.pmFrom : span.to;
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
  /** Range notes projected so far in the current textblock: each one's `id`, so equal adjacent notes stay apart. */
  notes: number;
  styles: ProjectedStyles;
}

type SegmentKind = 'heading' | 'bullet' | 'ordered' | 'run';

/** A top-level stretch of source that becomes one block (or one list item), and the label after it. */
interface Segment {
  kind: SegmentKind;
  nodes: SyntaxNode[];
  from: number;
  /** The end of the block's own source, before its label. */
  to: number;
  label: SyntaxNode | null;
}

/** Where a segment's source ends, its label included. */
function end(segment: Segment): number {
  return segment.label?.to ?? segment.to;
}

/** Syntax that makes a run of inline content a paragraph rather than a raw block. */
const PROSE = new Set(['Text', 'Strong', 'Emph', 'Escape', 'Shorthand', 'SmartQuote', 'Linebreak', 'Link', 'Raw', 'Ref']);
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

/**
 * Splits markup into blocks: headings and list items stand alone, the rest
 * forms runs up to a paragraph break. A label right after a heading, or at the
 * end of a run, goes with that segment.
 */
function segment(nodes: SyntaxNode[]): Segment[] {
  const segments: Segment[] = [];
  let run: SyntaxNode[] = [];
  const flushRun = () => {
    while (run.length > 0 && run.at(-1)!.name === 'Space') run.pop();
    if (run.length > 0) {
      const { content, label } = splitTrailingLabel(run);
      segments.push({ kind: 'run', nodes: content, from: content[0].from, to: content.at(-1)!.to, label });
    }
    run = [];
  };
  nodes.forEach((node, index) => {
    const kind = blockKind(node);
    const last = segments.at(-1);
    if (kind) {
      flushRun();
      segments.push({ kind, nodes: [node], from: node.from, to: node.to, label: null });
    } else if (node.name === 'Parbreak') {
      flushRun();
    } else if (run.length === 0 && last?.kind === 'heading' && !last.label && labelAfterHeading(nodes, index, last.nodes[0], BLOCK_KINDS)) {
      last.label = node;
    } else if (node.name !== 'Space' || run.length > 0) {
      run.push(node);
    }
  });
  flushRun();
  return segments;
}

const BLOCK_KINDS: Record<string, SegmentKind> = { Heading: 'heading', ListItem: 'bullet', EnumItem: 'ordered' };

function blockKind(node: SyntaxNode): SegmentKind | null {
  return BLOCK_KINDS[node.name] ?? null;
}

function sepAfter(segments: Segment[], index: number, source: string): string | null {
  const next = segments[index + 1];
  return next ? source.slice(end(segments[index]), next.from) : null;
}

/** The block a segment becomes, with the segment's label (if any) as its `label` attribute. */
function toBlock(ctx: Context, segment: Segment, sep: string | null): Node {
  const block = unlabelledBlock(ctx, segment, sep);
  if (!segment.label) return block;
  const label: BlockLabel = { name: ctx.source.slice(segment.label.from + 1, segment.label.to - 1), gap: ctx.source.slice(segment.to, segment.label.from) };
  const labelled = block.type.create({ ...block.attrs, label }, block.content, block.marks);
  if (pristine.has(block)) pristine.set(labelled, pristine.get(block)!);
  return labelled;
}

function unlabelledBlock(ctx: Context, segment: Segment, sep: string | null): Node {
  const [node] = segment.nodes;
  const src = ctx.source.slice(segment.from, segment.to);
  switch (segment.kind) {
    case 'heading':
      return heading(ctx, node, sep);
    case 'bullet':
      return taskItem(ctx, node, sep) ?? listItem(ctx, node, sep);
    case 'ordered':
      return listItem(ctx, node, sep);
    case 'run':
      return runBlock(ctx, segment, src, sep);
  }
}

/** A run of inline syntax: a code block, a paragraph, a block call or else a raw block. */
function runBlock(ctx: Context, segment: Segment, src: string, sep: string | null): Node {
  const code = segment.nodes.length === 1 ? codeBlock(ctx, segment.nodes[0], sep) : null;
  if (code) return code;
  if (segment.nodes.some((n) => PROSE.has(n.name) || isProseCall(ctx, n))) {
    return textblock(ctx, { type: 'paragraph', attrs: { src, sep } }, segment.from, inline(ctx, segment.nodes));
  }
  return blockCall(ctx, segment, sep) ?? ctx.schema.nodes.rawBlock.create({ src, sep });
}

/** Raw text Typst shows as a block: a code block whose text is the source between the delimiters. */
function codeBlock(ctx: Context, node: SyntaxNode, sep: string | null): Node | null {
  const code = rawCode(node, ctx.source);
  if (!code?.block) return null;
  const text = ctx.source.slice(code.from, code.to);
  const attrs = { language: code.lang, fence: code.fence, src: ctx.source.slice(node.from, node.to), sep };
  const content = text ? [{ node: ctx.schema.text(text), from: code.from, to: code.to }] : [];
  return textblock(ctx, { type: 'codeBlock', attrs, contentTo: code.to }, node.from, content);
}

function heading(ctx: Context, node: SyntaxNode, sep: string | null): Node {
  const level = Math.min(6, (node.getChild('HeadingMarker')?.to ?? node.from + 1) - node.from);
  const markup = node.getChild('Markup');
  const src = ctx.source.slice(node.from, node.to);
  return textblock(ctx, { type: 'heading', attrs: { level, src, sep } }, node.from, markup ? inline(ctx, children(markup)) : []);
}

/** Calls that belong in running text: `link(..)`, which is prose like a bare URL, margin notes and text styles. */
function isProseCall(ctx: Context, node: SyntaxNode): boolean {
  if (node.name !== 'FuncCall') return false;
  const { name } = callee(ctx, node);
  return name === 'link' || ctx.styles.get(name)?.kind === 'text' || noteCallSyntax(ctx.source, node) !== null;
}

/** Projects the blocks of a markup range: `doc` content, a table cell's. */
function blocks(ctx: Context, segments: Segment[]): Node[] {
  return groupLists(ctx, segments.map((s, i) => toBlock(ctx, s, sepAfter(segments, i, ctx.source))));
}

/** The name of the function `call` (a `FuncCall`) calls, and its argument list. */
function callee(ctx: Context, call: SyntaxNode): { name: string; args: SyntaxNode[] } {
  const ident = call.getChild('Ident');
  const args = call.getChild('Args');
  return { name: ident ? ctx.source.slice(ident.from, ident.to) : '', args: args ? children(args) : [] };
}

/** A run that is exactly one `#func(..)` call of a function modelled as a block (image, outline, table, figure with a label, align, par, quote, call atoms). */
function blockCall(ctx: Context, segment: Segment, sep: string | null): Node | null {
  const [hash, call, ...rest] = segment.nodes;
  if (hash.name !== 'Hash' || call?.name !== 'FuncCall' || call.from !== hash.to) return null;
  const { name, args } = callee(ctx, call);
  const ends = name === 'figure' ? isLabelAfter(rest) : rest.length === 0;
  if (!ends) return null;
  const projected = blockProjector(ctx, name)?.(ctx, segment, args, sep);
  if (projected) return projected;
  const atom = callAtomType(name, args, (n) => ctx.source.slice(n.from, n.to));
  return atom ? ctx.schema.nodes[atom].create({ src: ctx.source.slice(segment.from, segment.to), sep }) : null;
}

/** How a block quote's source lies around its content: `#quote(..)[` and `]`, with any whitespace inside. */
interface QuoteLayout {
  open: string;
  close: string;
}

const NEW_QUOTE: QuoteLayout = { open: '#quote(block: true)[', close: ']' };

/** `#quote(block: true, ..named)[content]`: a blockquote whose content is segmented like the document. */
function blockquote(ctx: Context, call: Segment, args: SyntaxNode[], sep: string | null): Node | null {
  const content = args.at(-1)!;
  const parens = args.slice(0, -1);
  if (!parenthesized(parens) || !isClosedContent(content) || !isBlockQuoteArgs(ctx, parens.slice(1, -1))) return null;
  const markup = content.getChild('Markup')!;
  const segments = segment(children(markup));
  const from = segments[0]?.from ?? markup.from;
  const to = segments.length > 0 ? end(segments.at(-1)!) : markup.from;
  const blocksInside = segments.length > 0 ? blocks(ctx, segments) : [textblock(ctx, { type: 'paragraph', attrs: { src: '' } }, from, [])];
  const layout: QuoteLayout = { open: ctx.source.slice(call.from, from), close: ctx.source.slice(to, call.to) };
  return ctx.schema.nodes.blockquote.create({ sep, layout }, blocksInside);
}

/** How a styled block's source lies around its content: `#note[` (or `#callout(..)[`) and `]`. Null: a new one. */
interface StyleLayout {
  open: string;
  close: string;
}

/** How a block call of `name` is projected: a modelled function, else a declared paragraph style. */
function blockProjector(ctx: Context, name: string): BlockProjector | undefined {
  return BLOCK_CALLS[name] ?? (ctx.styles.get(name)?.kind === 'paragraph' ? styledBlock : undefined);
}

/** `#name(..)?[content]` of a declared paragraph style: a `styledBlock` whose content is segmented like the document. */
function styledBlock(ctx: Context, call: Segment, args: SyntaxNode[], sep: string | null): Node | null {
  const { name } = callee(ctx, call.nodes[1]);
  const content = args.at(-1);
  const parens = args.slice(0, -1);
  if (!content || !isClosedContent(content) || (parens.length > 0 && !parenthesized(parens))) return null;
  const markup = content.getChild('Markup')!;
  const segments = segment(children(markup));
  const from = segments[0]?.from ?? markup.from;
  const to = segments.length > 0 ? end(segments.at(-1)!) : markup.from;
  const inside = segments.length > 0 ? blocks(ctx, segments) : [textblock(ctx, { type: 'paragraph', attrs: { src: '' } }, from, [])];
  const layout: StyleLayout = { open: ctx.source.slice(call.from, from), close: ctx.source.slice(to, call.to) };
  return ctx.schema.nodes.styledBlock.create({ name, title: ctx.styles.get(name)!.label, sep, layout }, inside);
}

/** Named arguments only, `block: true` among them. */
function isBlockQuoteArgs(ctx: Context, args: SyntaxNode[]): boolean {
  const named = args.filter((a) => a.name !== 'Space' && a.name !== 'Comma');
  return named.every((a) => a.name === 'Named') && named.some((a) => /^block\s*:\s*true$/.test(ctx.source.slice(a.from, a.to)));
}

/** Nothing, or one label after optional spaces. */
function isLabelAfter(nodes: SyntaxNode[]): boolean {
  return nodes.length === 0 || (nodes.at(-1)!.name === 'Label' && nodes.slice(0, -1).every((n) => n.name === 'Space'));
}

/** How a figure's source lies around its body (image or table call) and caption content, for printing it back. */
interface FigureLayout {
  /** From `#figure` to the body, e.g. `#figure(`. */
  open: string;
  /** Around the caption's content: from the body to the content, and after the content to the end of the argument. */
  caption: { before: string; open: string; close: string } | null;
  /** The rest: other arguments, `)`, a label. */
  rest: string;
}

/** The layout of a figure made in the editor: `#figure(image(..), caption: [..])`. */
const NEW_FIGURE: FigureLayout = { open: '#figure(', caption: null, rest: ')' };
const NEW_CAPTION = { before: ', ', open: 'caption: [', close: ']' };

/**
 * `#figure(image("path", ..), ..named) <label>?` or `#figure(table(..), ..)`
 * (a table as `table` projects it) whose `caption`, if any, is one paragraph
 * of markup; other named arguments stay as written.
 */
function figure(ctx: Context, segment: Segment, args: SyntaxNode[], sep: string | null): Node | null {
  const parsed = figureArgs(ctx, args);
  if (!parsed) return null;
  const { schema, source } = ctx;
  const { body, bodyNode, caption } = parsed;
  const layout: FigureLayout = { open: source.slice(segment.from, body.from), caption: null, rest: '' };
  if (!caption) {
    layout.rest = source.slice(body.to, segment.to);
    return schema.nodes.figure.create({ sep, layout }, [bodyNode]);
  }
  const { from, to, nodes } = captionContent(caption.content);
  layout.caption = { before: source.slice(body.to, caption.arg.from), open: source.slice(caption.arg.from, from), close: source.slice(to, caption.arg.to) };
  layout.rest = source.slice(caption.arg.to, segment.to);
  const captionNode = textblock(ctx, { type: 'figureCaption', attrs: { src: source.slice(from, to) } }, from, inline(ctx, nodes));
  return schema.nodes.figure.create({ sep, layout }, [bodyNode, captionNode]);
}

/** The body (call and node) and the caption argument of a figure, if it is an image or table with an optional one-paragraph caption. */
function figureArgs(ctx: Context, args: SyntaxNode[]): { body: SyntaxNode; bodyNode: Node; caption: CaptionArg | null } | null {
  if (!parenthesized(args)) return null;
  const [body, ...others] = args.slice(1, -1).filter((a) => a.name !== 'Space' && a.name !== 'Comma');
  const bodyNode = body ? figureBody(ctx, body) : null;
  const caption = bodyNode ? captionArg(ctx, others) : undefined;
  return caption === undefined ? null : { body, bodyNode: bodyNode!, caption };
}

/** A figure's body: `image("literal path", ..)`, or `table(..)` as a table. */
function figureBody(ctx: Context, node: SyntaxNode): Node | null {
  if (node.name !== 'FuncCall') return null;
  const { name, args } = callee(ctx, node);
  if (name === 'table') return table(ctx, node, args, null);
  const src = ctx.source.slice(node.from, node.to);
  return name === 'image' && parenthesized(args) && imagePath(src) !== null ? ctx.schema.nodes.image.create({ src }) : null;
}

/** A figure's `caption: [..]` argument and its content block. */
interface CaptionArg {
  arg: SyntaxNode;
  content: SyntaxNode;
}

/** Among named arguments, the caption: null if there is none, undefined if the arguments cannot be modelled. */
function captionArg(ctx: Context, args: SyntaxNode[]): CaptionArg | null | undefined {
  const names = args.map((a) => (a.name === 'Named' ? a.getChild('Ident') : null));
  if (names.some((n) => n === null)) return undefined;
  const captions = args.filter((_, i) => ctx.source.slice(names[i]!.from, names[i]!.to) === 'caption');
  if (captions.length === 0) return null;
  const [arg] = captions;
  const content = arg.lastChild!;
  return captions.length === 1 && isClosedContent(content) && isOneParagraph(content.getChild('Markup')!) ? { arg, content } : undefined;
}

function isOneParagraph(markup: SyntaxNode): boolean {
  return children(markup).every((n) => n.name !== 'Parbreak' && blockKind(n) === null);
}

/** A content block's markup without the spaces at its edges, and where that lies. */
function captionContent(block: SyntaxNode): { from: number; to: number; nodes: SyntaxNode[] } {
  const markup = block.getChild('Markup')!;
  const nodes = children(markup);
  while (nodes[0]?.name === 'Space') nodes.shift();
  while (nodes.at(-1)?.name === 'Space') nodes.pop();
  const from = nodes[0]?.from ?? markup.from;
  return { from, to: nodes.at(-1)?.to ?? from, nodes };
}

/** Whether a figure's source has more than its image and caption: other arguments, a label, comments. */
export function hasFigureExtras(figure: Node): boolean {
  const layout: FigureLayout = figure.attrs.layout ?? NEW_FIGURE;
  return figure.attrs.label !== null || (layout.open + (layout.caption?.before ?? '') + layout.rest).replace(/[\s,]/g, '') !== '#figure()';
}

/** Block calls by function name; each checks its arguments and projects the call, or returns null. */
type BlockProjector = (ctx: Context, call: Segment, args: SyntaxNode[], sep: string | null) => Node | null;

const BLOCK_CALLS: Record<string, BlockProjector> = {
  image: (ctx, call, args, sep) => {
    const src = ctx.source.slice(call.from, call.to);
    return parenthesized(args) && imagePath(src) !== null ? ctx.schema.nodes.image.create({ src, sep }) : null;
  },
  outline: (ctx, call, args, sep) =>
    parenthesized(args) ? ctx.schema.nodes.outline.create({ src: ctx.source.slice(call.from, call.to), sep }) : null,
  table: (ctx, call, args, sep) => table(ctx, call, args, sep),
  figure: (ctx, call, args, sep) => figure(ctx, call, args, sep),
  align: (ctx, call, args, sep) => alignment(ctx, call, args, sep),
  par: (ctx, call, args, sep) => justified(ctx, call, args, sep),
  quote: (ctx, call, args, sep) => blockquote(ctx, call, args, sep),
};

/** How a table's source lies around its cells, for printing it back. */
interface TableLayout {
  columns: number;
  /** The source before, between and after the cells' content; one more than cells. */
  gaps: string[];
  /** Per cell: written bare, as an expression (`ms(18)`), so its gaps hold no brackets. */
  bare: boolean[];
  /** The first row is a `table.header(..)`. */
  header: boolean;
  /** How the rows are written, for re-printing the table once its shape changed. */
  style: TableStyle;
}

/** How a table's arguments are written: what a re-printed table keeps. */
interface TableStyle {
  /** The source from the call to the first row, around the `columns` count. */
  head: [string, string];
  /** Named arguments written between rows; re-printed after the head. */
  named: string[];
  /** Between the cells of a row and between rows, e.g. `, ` and `,\n  `. */
  cellSep: string;
  rowSep: string;
  /** Around and between the header row's cells. */
  header: { open: string; sep: string; close: string };
  /** After the last row: e.g. `,\n)`. */
  tail: string;
}

/** The style of a table made in the editor: `#table(\n  columns: n,\n  [..], [..],\n)`. */
const NEW_TABLE: TableStyle = {
  head: ['#table(\n  columns: ', ',\n  '],
  named: [],
  cellSep: ', ',
  rowSep: ',\n  ',
  header: { open: 'table.header(', sep: ', ', close: ')' },
  tail: ',\n)',
};

/**
 * `#table(columns: n, ..)` (or `table(..)` as a figure's body) whose
 * positional arguments fill n columns, optionally starting with a one-row
 * `table.header(..)`. A cell is a content block `[..]` or an expression
 * (`ms(18)`, `$x^2$`), which becomes a raw box in a cell of its own.
 */
function table(ctx: Context, call: { from: number; to: number }, args: SyntaxNode[], sep: string | null): Node | null {
  const parsed = tableArgs(ctx, args);
  if (!parsed || parsed.cells.length === 0 || parsed.cells.length % parsed.columns !== 0) return null;
  if (parsed.headerCells !== 0 && parsed.headerCells !== parsed.columns) return null;
  const style = tableStyle(ctx, call, parsed);
  if (!style) return null;
  const { schema, source } = ctx;
  const gaps: string[] = [];
  let pos = call.from;
  const cells = parsed.cells.map(({ node, bare }, index) => {
    const { content, from, to } = bare ? bareCell(ctx, node) : contentBlocks(ctx, node);
    gaps.push(source.slice(pos, from));
    pos = to;
    return (index < parsed.headerCells ? schema.nodes.tableHeader : schema.nodes.tableCell).create(null, content);
  });
  gaps.push(source.slice(pos, call.to));
  const rows: Node[] = [];
  for (let i = 0; i < cells.length; i += parsed.columns) rows.push(schema.nodes.tableRow.create(null, cells.slice(i, i + parsed.columns)));
  const bare = parsed.cells.map((c) => c.bare);
  const layout: TableLayout = { columns: parsed.columns, gaps, bare, header: parsed.headerCells > 0, style };
  return schema.nodes.table.create({ sep, layout }, rows);
}

/** A cell written as an expression: a paragraph holding it as a raw box (code, without `#`). */
function bareCell(ctx: Context, node: SyntaxNode): { content: Node[]; from: number; to: number } {
  const src = ctx.source.slice(node.from, node.to);
  const atom = ctx.schema.nodes.rawInline.create({ src, code: true });
  const paragraph = textblock(ctx, { type: 'paragraph', attrs: { src } }, node.from, [{ node: atom, from: node.from, to: node.to }]);
  return { content: [paragraph], from: node.from, to: node.to };
}

/** Separators between table arguments: a comma and whitespace, nothing else (no comments). */
const ARG_SEP = /^\s*,\s*$/;

/**
 * How the table's rows are written: the source before the first row (with
 * the `columns` count cut out), the separators of its last rows, the header
 * call's syntax and what follows the last row. Null if `columns` comes after
 * the first row.
 */
function tableStyle(ctx: Context, call: { from: number; to: number }, parsed: TableArgs): TableStyle | null {
  const text = (from: number, to: number) => ctx.source.slice(from, to);
  const between = (a: SyntaxNode | undefined, b: SyntaxNode | undefined) => (a && b ? text(a.to, b.from) : null);
  const cells = parsed.cells.map((c) => c.node);
  const rows: SyntaxNode[][] = parsed.header ? [[parsed.header]] : [];
  for (let i = parsed.headerCells; i < cells.length; i += parsed.columns) rows.push(cells.slice(i, i + parsed.columns));
  const first = rows[0][0];
  const last = rows.at(-1)!.at(-1)!;
  const count = parsed.columnsCount!;
  if (count.to > first.from) return null;
  const lastRow = rows.at(-1)!;
  const sepOf = (s: string | null, fallback: string) => (s !== null && ARG_SEP.test(s) ? s : fallback);
  const cellSep = sepOf(lastRow === rows[0] && parsed.header ? null : between(lastRow[0], lastRow[1]), NEW_TABLE.cellSep);
  const indent = /\s*$/.exec(text(call.from, first.from))![0];
  const rowSep = sepOf(between(rows.at(-2)?.at(-1), lastRow[0]), indent.includes('\n') ? `,${indent}` : cellSep);
  return {
    head: [text(call.from, count.from), text(count.to, first.from)],
    named: parsed.named.filter((n) => n.from > first.from && n.to <= last.from).map((n) => text(n.from, n.to)),
    cellSep,
    rowSep,
    header: parsed.header ? headerStyle(text, parsed.header, cells.slice(0, parsed.headerCells), cellSep) : { ...NEW_TABLE.header, sep: cellSep },
    tail: text(last.to, call.to),
  };
}

/** How a `table.header(..)` call is written around and between its `cells`. */
function headerStyle(text: (from: number, to: number) => string, call: SyntaxNode, cells: SyntaxNode[], cellSep: string): TableStyle['header'] {
  const sep = cells.length > 1 ? text(cells[0].to, cells[1].from) : cellSep;
  return {
    open: text(call.from, cells[0].from),
    // `table.header[a][b]` has no separators at all
    sep: sep === '' || ARG_SEP.test(sep) ? sep : cellSep,
    close: text(cells.at(-1)!.to, call.to),
  };
}

/** The blocks of a closed content block `[..]` (an empty paragraph if there are none) and the source range they cover. */
function contentBlocks(ctx: Context, block: SyntaxNode): { content: Node[]; from: number; to: number } {
  const markup = block.getChild('Markup')!;
  const segments = segment(children(markup));
  const from = segments[0]?.from ?? markup.from;
  const to = segments.length > 0 ? end(segments.at(-1)!) : markup.from;
  const content = segments.length > 0 ? blocks(ctx, segments) : [textblock(ctx, { type: 'paragraph', attrs: { src: '' } }, from, [])];
  return { content, from, to };
}

/** How an alignment block's source lies around its blocks, for printing it back. */
interface AlignLayout {
  /** The alignment argument as written. */
  args: string;
  /** The source up to the first block (`#align(args)[`, whitespace) and after the last one. */
  open: string;
  close: string;
}

/** `#align(<literal alignment>)[..]`: an alignment block whose content is projected like the document's. */
function alignment(ctx: Context, call: Segment, args: SyntaxNode[], sep: string | null): Node | null {
  const body = args.at(-1);
  const close = args.at(-2);
  if (args[0]?.name !== 'LeftParen' || close?.name !== 'RightParen' || !body || !isClosedContent(body)) return null;
  const argText = ctx.source.slice(args[0].to, close.from);
  if (!alignArgs(argText)) return null;
  const { content, from, to } = contentBlocks(ctx, body);
  const layout: AlignLayout = { args: argText, open: ctx.source.slice(call.from, from), close: ctx.source.slice(to, call.to) };
  return ctx.schema.nodes.alignment.create({ args: argText, sep, layout }, content);
}

/** `#par(justify: <bool>)[..]` around one paragraph's inline content: that paragraph, with its `justify` flag. */
function justified(ctx: Context, call: Segment, args: SyntaxNode[], sep: string | null): Node | null {
  if (args.map((a) => a.name).join() !== 'LeftParen,Named,RightParen,ContentBlock' || !isClosedContent(args[3])) return null;
  const justify = /^justify\s*:\s*(true|false)$/.exec(ctx.source.slice(args[1].from, args[1].to));
  const content = children(args[3].getChild('Markup')!);
  if (!justify || content.length === 0 || content.some((n) => n.name === 'Parbreak' || blockKind(n) !== null)) return null;
  const attrs = { src: ctx.source.slice(call.from, call.to), sep, justify: justify[1] === 'true' };
  return textblock(ctx, { type: 'paragraph', attrs }, call.from, inline(ctx, content));
}

interface TableArgs {
  columns: number;
  /** The `columns` integer. */
  columnsCount: SyntaxNode | null;
  /** Named arguments other than `columns`. */
  named: SyntaxNode[];
  /** The cells, the header's first: content blocks, or bare expressions. */
  cells: { node: SyntaxNode; bare: boolean }[];
  /** The `table.header(..)` call, if any, and how many of the cells are in it. */
  header: SyntaxNode | null;
  headerCells: number;
}

/**
 * The arguments of a table call: an integer `columns`, other named arguments
 * and cells only (see `tableCell`), the first of them optionally in a
 * `table.header(..)`.
 */
function tableArgs(ctx: Context, args: SyntaxNode[]): TableArgs | null {
  if (!parenthesized(args)) return null;
  const result: TableArgs = { columns: 0, columnsCount: null, named: [], cells: [], header: null, headerCells: 0 };
  for (const arg of args.slice(1, -1)) {
    if (arg.name === 'Space' || arg.name === 'Comma') continue;
    if (arg.name === 'Named') namedArg(ctx, arg, result);
    else if (!headerArg(ctx, arg, result)) {
      const cell = tableCell(ctx, arg);
      if (!cell) return null;
      result.cells.push(cell);
    }
  }
  return result.columns > 0 ? result : null;
}

/** Takes a `table.header(..)` of cells before any other cell as the header cells. */
function headerArg(ctx: Context, arg: SyntaxNode, into: TableArgs): boolean {
  const target = arg.name === 'FuncCall' ? arg.firstChild : null;
  if (!target || ctx.source.slice(target.from, target.to) !== 'table.header' || into.cells.length > 0) return false;
  const parts = children(arg.getChild('Args')!).filter((a) => !['LeftParen', 'RightParen', 'Space', 'Comma'].includes(a.name));
  const cells = parts.map((part) => tableCell(ctx, part));
  if (cells.length === 0 || cells.some((c) => c === null)) return false;
  into.cells.push(...(cells as { node: SyntaxNode; bare: boolean }[]));
  into.header = arg;
  into.headerCells = cells.length;
  return true;
}

/**
 * A cell argument: a closed content block, or an expression Typst would read
 * the same after a `#` in markup (`ms(18)`, `$x^2$`, `"text"`), which is
 * `bare`. Other `table.*` elements (cells with spans, lines, a footer) and
 * comments are not cells: the table stays raw.
 */
function tableCell(ctx: Context, arg: SyntaxNode): { node: SyntaxNode; bare: boolean } | null {
  if (isClosedContent(arg)) return { node: arg, bare: false };
  const src = ctx.source.slice(arg.from, arg.to);
  if (arg.name === 'ContentBlock' || /Comment/.test(arg.name) || /^table\s*\./.test(src)) return null;
  return isEmbeddable(src) ? { node: arg, bare: true } : null;
}

/** Whether an argument list is `(..)` alone: closed, and no trailing content block. */
function parenthesized(args: SyntaxNode[]): boolean {
  return args[0]?.name === 'LeftParen' && args.at(-1)?.name === 'RightParen';
}

function isClosedContent(node: SyntaxNode): boolean {
  return node.name === 'ContentBlock' && node.lastChild?.name === 'RightBracket' && node.getChild('Markup') !== null;
}

function namedArg(ctx: Context, arg: SyntaxNode, into: TableArgs): void {
  const name = arg.getChild('Ident');
  if (!name || ctx.source.slice(name.from, name.to) !== 'columns') {
    into.named.push(arg);
  } else if (arg.lastChild?.name === 'Int') {
    into.columns = Number(ctx.source.slice(arg.lastChild.from, arg.lastChild.to));
    into.columnsCount = arg.lastChild;
  } else {
    into.columns = NaN;
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

/** `- [ ] text` / `- [x] text` (one paragraph, a space after the box): a task item; the box is hidden syntax. */
function taskItem(ctx: Context, node: SyntaxNode, sep: string | null): Node | null {
  const markup = node.getChild('Markup');
  const box = markup ? TASK_BOX.exec(ctx.source.slice(markup.from, markup.to)) : null;
  if (!markup || !box) return null;
  const body = children(markup).filter((n) => n.from >= markup.from + box[0].length);
  if (body.some((n) => n.name === 'Parbreak' || blockKind(n) !== null)) return null;
  const from = markup.from + box[0].length;
  const paragraph = textblock(ctx, { type: 'paragraph', attrs: { src: ctx.source.slice(from, markup.to) } }, from, inline(ctx, body));
  const attrs = { marker: '-', checked: box[1] === 'x', src: ctx.source.slice(node.from, node.to), sep };
  return pristineNode(ctx, 'taskItem', attrs, [paragraph]);
}

/** cheq's unchecked and checked boxes; others (`[/]`, `[-]`, …) stay text. */
const TASK_BOX = /^\[([ x])\](?: |$)/;

/** Wraps consecutive list items of the same kind into one list; the last item's separator moves to the list. */
function groupLists(ctx: Context, blocks: Node[]): Node[] {
  const result: Node[] = [];
  let items: Node[] = [];
  const flush = () => {
    if (items.length === 0) return;
    const last = items.at(-1)!;
    items[items.length - 1] = pristineNode(ctx, last.type.name, { ...last.attrs, sep: null }, last.content);
    result.push(ctx.schema.nodes[listType(items[0])].create({ sep: last.attrs.sep }, items));
    items = [];
  };
  for (const block of blocks) {
    const isItem = block.type.name === 'listItem' || block.type.name === 'taskItem';
    if (!isItem || (items.length > 0 && listType(items[0]) !== listType(block))) flush();
    if (isItem) items.push(block);
    else result.push(block);
  }
  flush();
  return result;
}

/** The list a projected item belongs in. */
function listType(item: Node): string {
  if (item.type.name === 'taskItem') return 'taskList';
  return isOrdered(item) ? 'orderedList' : 'bulletList';
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
    if (nodes[i].from > pos) result.push({ node: raw(ctx, ctx.source.slice(pos, nodes[i].from), marks), from: pos, to: nodes[i].from });
    const piece = projectAt(ctx, nodes, i, marks);
    result.push(...piece.placed);
    pos = piece.to;
    i = piece.last;
  }
  return result;
}

/** Projects `nodes[index]`, or a `#` together with the expression after it as one piece of code. */
function projectAt(ctx: Context, nodes: SyntaxNode[], index: number, marks: readonly Mark[]): { placed: Placed[]; to: number; last: number } {
  const node = nodes[index];
  const code = node.name === 'Hash' && nodes[index + 1]?.from === node.to ? nodes[index + 1] : null;
  const to = code ? code.to : node.to;
  const context = { ctx, node: code ?? node, src: ctx.source.slice(node.from, to), marks };
  const projected = code ? codeNode(context) : inlineNode(context);
  return { placed: Array.isArray(projected) ? projected : [{ node: projected, from: node.from, to }], to, last: code ? index + 1 : index };
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
  Link: (c) => c.ctx.schema.text(c.src, c.ctx.schema.marks.link.create({ href: c.src }).addToSet(c.marks)),
  Raw: (c) => inlineCode(c) ?? raw(c.ctx, c.src, c.marks),
  Ref: (c) => reference(c),
};

/** `@key` / `@key[supplement]`: a `reference` atom; the supplement is kept as written. */
function reference({ ctx, node, marks }: InlineContext): Node {
  const marker = node.getChild('RefMarker')!;
  const supplement = node.getChild('ContentBlock');
  const attrs = { target: ctx.source.slice(marker.from + 1, marker.to), supplement: supplement ? ctx.source.slice(supplement.from, supplement.to) : null };
  return ctx.schema.nodes.reference.create(attrs, null, marks);
}

function inlineNode(context: InlineContext): Node | Placed[] {
  return (INLINE[context.node.name] ?? ((c: InlineContext) => raw(c.ctx, c.src, c.marks)))(context);
}

/**
 * Projects the expression after a `#`: `#link("url")[text]` becomes linked
 * text, a margin note a `marginNote` atom or `noteRange` text, anything else
 * a raw inline.
 */
function codeNode(context: InlineContext): Node | Placed[] {
  const modelled = context.node.name === 'FuncCall' && (linkCall(context) ?? marginNoteCall(context) ?? styleCall(context));
  return modelled || raw(context.ctx, context.src, context.marks);
}

/**
 * `#margin-note(..named)[note]` → a `marginNote` atom holding the call's head
 * and note; `#margin-note(..named)[text][note]` → `text` with a `noteRange`
 * mark holding them. Null for calls that are not margin notes.
 */
function marginNoteCall({ ctx, node, marks }: InlineContext): Node | Placed[] | null {
  const syntax = noteCallSyntax(ctx.source, node);
  if (!syntax) return null;
  const { head, text, note } = syntax;
  if (!text) return ctx.schema.nodes.marginNote.create({ head, note }, null, marks);
  const mark = ctx.schema.marks.noteRange.create({ head, note, id: ctx.notes++ });
  return inline(ctx, children(text.getChild('Markup')!), mark.addToSet(marks));
}

/** `#link("url")[text]` with a plain string and non-empty, single-paragraph text; null otherwise. */
function linkCall({ ctx, node, marks }: InlineContext): Placed[] | null {
  const { name, args } = callee(ctx, node);
  if (name !== 'link' || args.map((a) => a.name).join() !== 'LeftParen,Str,RightParen,ContentBlock') return null;
  const href = decodeString(ctx.source.slice(args[1].from, args[1].to));
  const markup = args[3].getChild('Markup');
  const content = markup ? children(markup) : [];
  if (href === null || !isClosedContent(args[3]) || content.length === 0) return null;
  if (content.some((n) => n.name === 'Parbreak')) return null;
  return inline(ctx, content, ctx.schema.marks.link.create({ href }).addToSet(marks));
}

/** `#key[text]` (or `#key(..)[text]`) of a declared text style, with non-empty, single-paragraph text; null otherwise. */
function styleCall({ ctx, node, marks }: InlineContext): Placed[] | null {
  const { name, args } = callee(ctx, node);
  const style = ctx.styles.get(name);
  const content = args.at(-1);
  const parens = args.slice(0, -1);
  if (style?.kind !== 'text' || !content || !isClosedContent(content) || (parens.length > 0 && !parenthesized(parens))) return null;
  const inside = children(content.getChild('Markup')!);
  if (inside.length === 0 || inside.some((n) => n.name === 'Parbreak')) return null;
  // the `#` before the call up to and with the `[`: printed again as is
  const head = ctx.source.slice(node.from - 1, content.from + 1);
  return inline(ctx, inside, ctx.schema.marks.style.create({ name, title: style.label, head }).addToSet(marks));
}

/** Raw text on one line: its text with a `code` mark remembering the delimiters; null for empty or multi-line raw text. */
function inlineCode({ ctx, node, marks }: InlineContext): Placed[] | null {
  const code = rawCode(node, ctx.source);
  const text = code ? ctx.source.slice(code.from, code.to) : '';
  if (!code || code.block || !text || text.includes('\n')) return null;
  const mark = ctx.schema.marks.code.create({ fence: code.fence, lang: code.lang });
  return [{ node: ctx.schema.text(text, mark.addToSet(marks)), from: code.from, to: code.to }];
}

/** A Typst string literal's value, if it uses no escapes other than `\"` and `\\`. */
function decodeString(literal: string): string | null {
  return /^"(?:[^"\\\n]|\\["\\])*"$/.test(literal) ? literal.slice(1, -1).replace(/\\(["\\])/g, '$1') : null;
}

/** A Typst string literal with value `text`. */
function quote(text: string): string {
  return `"${text.replace(/["\\]/g, '\\$&')}"`;
}

/** The path of the image an `#image("path", ..)` call (or a figure's `image(..)`) shows; null if it is not a call with a literal path. */
export function imagePath(src: string): string | null {
  const literal = /^#?image\(\s*("(?:[^"\\\n]|\\.)*")/.exec(src);
  return literal ? decodeString(literal[1]) : null;
}

/** The source of an image block showing the image at `path`. */
export function imageSource(path: string): string {
  return `#image(${quote(path)})`;
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

/**
 * A pristine textblock whose `attrs.src` starts at source offset `from`.
 * Its content ends at `contentTo` (default: the end of `src`); syntax after
 * that closes the block (e.g. a code block's fence).
 */
function textblock(
  ctx: Context,
  { type, attrs, contentTo }: { type: string; attrs: { src: string } & Record<string, unknown>; contentTo?: number },
  from: number,
  content: Placed[],
): Node {
  const node = ctx.schema.nodes[type].create(attrs, content.map((p) => p.node));
  const to = from + attrs.src.length;
  pristine.set(node, layout(content, from, contentTo ?? to, to));
  ctx.notes = 0; // the next textblock numbers its range notes from 0 again
  return node;
}

/** How a pristine textblock's `src` lines up with its content: visible runs, with hidden syntax before each. */
interface InlineLayout {
  runs: { hidden: number; length: number; size: number; kind: 'text' | 'atom' }[];
  /** Hidden syntax after the last run, up to the end of the content. */
  tail: number;
  /** Syntax closing the block, after its content. */
  closing: number;
}

function layout(content: Placed[], from: number, contentTo: number, to: number): InlineLayout {
  let cursor = from;
  const runs = content.map(({ node, from: start, to: end }) => {
    const run = { hidden: start - cursor, length: end - start, size: node.nodeSize, kind: textKind(node, end - start) };
    cursor = end;
    return run;
  });
  return { runs, tail: contentTo - cursor, closing: to - contentTo };
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

  /**
   * Closes a textblock whose content ends at `pos`: its trailing syntax maps
   * there. An `empty` block shows no source, so a zero-width span marks where
   * its content would go.
   */
  endBlock(pos: number, empty: boolean): void {
    this.settle(pos);
    this.end = pos;
    if (empty) this.spans.push({ from: this.text.length, to: this.text.length, pmFrom: pos, pmTo: pos, kind: 'text' });
  }

  /** Source closing the block printed last (e.g. a table cell's `]`); it maps to that block's end. */
  closing(src: string): void {
    this.write(src, 'syntax', this.end, this.end);
  }

  /** Source right after the syntax printed last, mapping where that syntax maps (e.g. a block's label). */
  after(src: string): void {
    if (this.pending.length > 0) this.hidden(src);
    else this.closing(src);
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

/** Prints `node`, which starts at document position `pos`, and its label; the label maps to the block's end. */
function printBlock(out: Printer, node: Node, parent: Node, pos: number): void {
  printUnlabelled(out, node, parent, pos);
  if (node.attrs.label) out.after(labelSyntax(node.attrs.label));
}

function printUnlabelled(out: Printer, node: Node, parent: Node, pos: number): void {
  const pristineLayout = pristine.get(node);
  if (pristineLayout) return printLayout(out, node, pristineLayout, pos + 1);
  if (pristine.has(node)) return printPristineItem(out, node, pos);
  if (isSourceAtom(node)) return out.shown(node.attrs.src, 'atom', pos, pos + 1);
  (PRINT_BLOCK[node.type.name] ?? printTextblock)(out, node, pos, parent);
}

type BlockPrinter = (out: Printer, node: Node, pos: number, parent: Node) => void;

const printList: BlockPrinter = (out, list, pos) => printBlocks(out, list, pos + 1, '\n');

/** Printers of edited (non-pristine) blocks by node type; any other block is a textblock. */
const PRINT_BLOCK: Record<string, BlockPrinter> = {
  heading: (out, heading, pos) => {
    out.hidden(`${'='.repeat(heading.attrs.level)} `);
    printTextblock(out, heading, pos);
  },
  bulletList: printList,
  orderedList: printList,
  taskList: printList,
  listItem: (out, item, pos, list) => printListItem(out, item, list, pos),
  taskItem: (out, item, pos) => printItem(out, item, pos, `- [${item.attrs.checked ? 'x' : ' '}] `),
  table: (out, table, pos) => printTable(out, table, pos),
  figure: (out, figure, pos) => printFigure(out, figure, pos),
  alignment: (out, block, pos) => printAlignment(out, block, pos),
  codeBlock: (out, block, pos) => printCodeBlock(out, block, pos),
  blockquote: (out, quote, pos) => printQuote(out, quote, pos),
  styledBlock: (out, block, pos) => printStyledBlock(out, block, pos),
};

/** `#name[..]` around a styled block's blocks, or the call around them as projected. */
function printStyledBlock(out: Printer, block: Node, pos: number): void {
  const { open, close }: StyleLayout = block.attrs.layout ?? { open: `#${block.attrs.name}[`, close: ']' };
  out.hidden(open);
  printBlocks(out, block, pos + 1, '\n\n');
  out.closing(close);
}

/** `#quote(block: true)[..]` around the quote's blocks, or the source around them as projected. */
function printQuote(out: Printer, quote: Node, pos: number): void {
  const { open, close }: QuoteLayout = quote.attrs.layout ?? NEW_QUOTE;
  out.hidden(open);
  printBlocks(out, quote, pos + 1, '\n\n');
  out.closing(close);
}

/** A block shown as a whole and printed as its `src`: raw blocks, images, page breaks, rules. */
function isSourceAtom(node: Node): boolean {
  return node.isBlock && node.isAtom && typeof node.attrs.src === 'string';
}

/** A pristine textblock: its `src`, with the content positions its layout assigns. */
function printLayout(out: Printer, block: Node, { runs, tail, closing }: InlineLayout, start: number): void {
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
  out.endBlock(pos, pos === start);
  out.closing(src.slice(from + tail, from + tail + closing));
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
  const justify: boolean | null = block.attrs.justify ?? null;
  if (justify !== null) out.hidden(`#par(justify: ${justify})[`);
  printInline(out, block, pos + 1);
  if (justify !== null) out.hidden(']');
  out.endBlock(pos + block.nodeSize - 1, block.content.size === 0);
}

/** An edited code block: its text verbatim between fences that keep it intact. */
function printCodeBlock(out: Printer, block: Node, pos: number): void {
  const text = block.textContent;
  const { open, close } = codeBlockDelimiters(text, block.attrs.language, block.attrs.fence);
  out.hidden(open);
  out.shown(text, 'text', pos + 1, pos + 1 + text.length);
  out.endBlock(pos + block.nodeSize - 1, text.length === 0);
  out.closing(close);
}

/** `- body`, with further children (e.g. a nested list) on following lines, indented. */
function printListItem(out: Printer, item: Node, list: Node, pos: number): void {
  const ordered = list.type.name === 'orderedList';
  const keepMarker = item.attrs.marker !== null && ORDERED_MARKER.test(item.attrs.marker) === ordered;
  printItem(out, item, pos, `${keepMarker ? item.attrs.marker : ordered ? '+' : '-'} `);
}

/** `prefix` (the marker), the first child, then further children on following lines, indented. */
function printItem(out: Printer, item: Node, pos: number, prefix: string): void {
  out.hidden(prefix);
  item.forEach((child, offset, index) => {
    if (index === 0) return printBlock(out, child, item, pos + 1 + offset);
    out.hidden('\n');
    out.indented(() => printBlock(out, child, item, pos + 1 + offset));
  });
}

/** `#align(args)[blocks]`, keeping the source around the blocks as projected; only a changed `args` is re-printed. */
function printAlignment(out: Printer, block: Node, pos: number): void {
  const args: string = block.attrs.args;
  const layout: AlignLayout = block.attrs.layout ?? { args, open: `#align(${args})[`, close: ']' };
  const head = '#align(';
  out.hidden(layout.args === args ? layout.open : head + args + layout.open.slice(head.length + layout.args.length));
  printBlocks(out, block, pos + 1, '\n\n');
  out.closing(layout.close);
}

/** A table cell and the document position it starts at. */
interface PlacedCell {
  cell: Node;
  pos: number;
}

/**
 * A table: its source around unchanged cell content while it still has the
 * projected shape, so editing a cell changes just that cell; otherwise
 * re-printed in the style it was written in (see `TableStyle`; editor-made:
 * `#table(columns: n, [..], ..)`, one row per line), the first row in
 * `table.header(..)` if its cells are header cells.
 */
function printTable(out: Printer, table: Node, pos: number): void {
  const rows: PlacedCell[][] = [];
  table.forEach((row, rowOffset) => {
    const cells: PlacedCell[] = [];
    row.forEach((cell, cellOffset) => cells.push({ cell, pos: pos + 1 + rowOffset + 1 + cellOffset }));
    rows.push(cells);
  });
  const layout: TableLayout | null = table.attrs.layout;
  if (layout && hasShape(rows, layout)) return printInLayout(out, rows.flat(), layout);
  const style = layout?.style ?? NEW_TABLE;
  out.hidden(style.head[0] + rows[0].length + style.head[1]);
  const indent = /\s*$/.exec(style.head[1])![0] || ' ';
  for (const arg of style.named) out.hidden(`${arg},${indent}`);
  rows.forEach((row, r) => {
    if (r > 0) out.hidden(style.rowSep);
    const { open, sep, close } = r === 0 && isHeaderRow(row) ? headerSyntax(style, row) : { open: '', sep: style.cellSep, close: '' };
    out.hidden(open);
    row.forEach((cell, i) => {
      if (i > 0) out.hidden(sep);
      printCell(out, cell, true);
    });
    out.hidden(close);
  });
  out.hidden(style.tail);
}

/** The table's source around its cells, as projected; only edited cells print anew. */
function printInLayout(out: Printer, cells: PlacedCell[], { gaps, bare }: TableLayout): void {
  gaps.forEach((gap, i) => {
    // the part up to `]` closes the previous cell (bare cells have none), the rest opens the next one
    const close = i === 0 || bare[i - 1] ? 0 : gap.indexOf(']') + 1;
    out.closing(gap.slice(0, close));
    out.hidden(gap.slice(close));
    if (i < cells.length) printCell(out, cells[i], bare[i]);
  });
}

/**
 * A cell's content. A cell holding just a code box prints its code, if
 * `bracketed` is set (its source has no brackets of its own) and the code is
 * still one expression; other cells print their blocks, in brackets if
 * `bracketed` (`[#ms(18) more]`).
 */
function printCell(out: Printer, { cell, pos }: PlacedCell, bracketed: boolean): void {
  const code = bracketed ? bareCode(cell) : null;
  if (code) {
    out.shown(code.attrs.src, 'atom', pos + 2, pos + 3);
    return out.endBlock(pos + 3, false);
  }
  if (bracketed) out.hidden('[');
  printBlocks(out, cell, pos + 1, '\n\n');
  if (bracketed) out.closing(']');
}

/** The code box a cell consists of, if it can be printed as a bare expression. */
function bareCode(cell: Node): Node | null {
  const only = (node: Node | null) => (node?.childCount === 1 ? node.firstChild : null);
  const paragraph = only(cell);
  const atom = paragraph?.type.name === 'paragraph' && paragraph.attrs.justify == null ? only(paragraph) : null;
  const isCode = atom?.type.name === 'rawInline' && atom.attrs.code && atom.marks.length === 0;
  return isCode && isEmbeddable(atom.attrs.src) ? atom : null;
}

/** `table.header(..)` around a header row, as written; the bracket form `table.header[a][b]` only if it holds no bare cells. */
function headerSyntax({ header }: TableStyle, row: PlacedCell[]): TableStyle['header'] {
  return header.open.endsWith('(') || !row.some(({ cell }) => bareCode(cell)) ? header : NEW_TABLE.header;
}

/**
 * A figure: its source around the body (image or table) and the caption content, so
 * each prints (and changes) on its own. An added caption goes right after the
 * body; a removed one takes its argument and the comma before it along.
 */
function printFigure(out: Printer, figure: Node, pos: number): void {
  const layout: FigureLayout = figure.attrs.layout ?? NEW_FIGURE;
  const body = figure.child(0);
  out.hidden(layout.open);
  printBlock(out, body, figure, pos + 1);
  if (figure.childCount > 1) {
    const around = layout.caption ?? NEW_CAPTION;
    out.hidden(around.before + around.open);
    printBlock(out, figure.child(1), figure, pos + 1 + body.nodeSize);
    out.closing(around.close);
  } else if (layout.caption) {
    out.hidden(layout.caption.before.replace(/,\s*$/, ''));
  }
  out.hidden(layout.rest);
}

/** Whether the table still has the rows, columns and header its source `layout` was made for. */
function hasShape(rows: PlacedCell[][], { columns, gaps, header }: TableLayout): boolean {
  return rows.every((row) => row.length === columns) && rows.length * columns === gaps.length - 1 && isHeaderRow(rows[0]) === header;
}

/** A row of header cells only (Tiptap's header row). */
function isHeaderRow(row: PlacedCell[]): boolean {
  return row.every(({ cell }) => cell.type.name === 'tableHeader');
}

/** Typst syntax around a formatted span, by mark: e.g. `*…*`, or `#strong[…]` where delimiters would not work. */
const FORMATTING: Record<string, (mark: Mark, around: Around) => { open: string; close: string }> = {
  bold: (_mark, around) => delimitedSyntax('*', 'strong', around),
  italic: (_mark, around) => delimitedSyntax('_', 'emph', around),
  link: (mark) => ({ open: `#link(${quote(mark.attrs.href)})[`, close: ']' }),
  code: (mark, { text }) => inlineCodeDelimiters(text, mark.attrs.lang, mark.attrs.fence),
  noteRange: (mark) => rangeNoteSyntax(mark.attrs.head, mark.attrs.note),
  style: (mark) => ({ open: mark.attrs.head ?? `#${mark.attrs.name}[`, close: ']' }),
};

/** What a formatted span starts and ends with, and the printed characters around it. */
interface Around {
  before: string | undefined;
  after: string | undefined;
  first: string;
  last: string;
  /** The span's text, as the document shows it. */
  text: string;
}

function delimitedSyntax(delimiter: string, func: string, around: Around): { open: string; close: string } {
  return needsFunctionSyntax(around) ? { open: `#${func}[`, close: ']' } : { open: delimiter, close: delimiter };
}

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
 * spans outside), choosing `*x*` or `#strong[x]` so the result parses back
 * the same, and a link showing its own URL as a bare URL where Typst reads
 * it back as one. Code is raw text, which holds no markup: it is always
 * innermost, closed and reopened around any other formatting change.
 */
function printInline(out: Printer, block: Node, start: number): void {
  const pieces = inlinePieces(block, start);
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
    let opening = marksToOpen(pieces, i, open);
    if (opening.length > 0 && open.at(-1)?.mark.type.name === 'code') {
      closeFrom(open.length - 1);
      opening = marksToOpen(pieces, i, open);
    }
    opening.forEach(({ mark, end }, n) => {
      const spanText = pieces.slice(i, end + 1).map((p) => p.text).join('');
      const next = pieces[end + 1];
      const around = { before: printedSoFar.at(-1), after: next?.code ? '`' : next?.text[0], first: piece.text, last: pieces[end].text, text: spanText };
      if (n === opening.length - 1 && end === i && isBareLink(mark, piece, around)) {
        open.push({ mark, close: '' });
        text = piece.node.text!;
        return;
      }
      const syntax = FORMATTING[mark.type.name](mark, around);
      hidden(syntax.open);
      open.push({ mark, close: syntax.close });
    });
    text = guardCall(printedSoFar, text, piece.escaped);
    if (piece.escaped && i > 0) text = guardAfterReference(pieces[i - 1].node, text);
    printedSoFar += text;
    printPiece(out, piece, text);
  });
  while (open.length > 0) hidden(open.pop()!.close);
}

/**
 * The marks of `pieces[index]` not open yet, with the last piece they span;
 * longer spans first, code last (it spans only pieces formatted alike).
 */
function marksToOpen(pieces: Piece[], index: number, open: { mark: Mark }[]): { mark: Mark; end: number }[] {
  const isCode = (mark: Mark) => Number(mark.type.name === 'code');
  return pieces[index].marks
    .filter((mark) => !open.some((o) => o.mark.eq(mark)))
    .map((mark) => ({ mark, end: isCode(mark) ? alikeEnd(pieces, index) : spanEnd(pieces, index, mark) }))
    .sort((a, b) => isCode(a.mark) - isCode(b.mark) || b.end - a.end);
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

/** Bare URL characters, not ending in punctuation that Typst would leave out of the link. */
const BARE_URL = /^https?:\/\/[\w\-.~:/?#@!$&'*+,;=%]*[\w\-~/#@$&+=%]$/;

/** A link over exactly its own URL, between spaces: printed bare, Typst reads it back as the same link. */
function isBareLink(mark: Mark, piece: Piece, { before, after }: Around): boolean {
  const href: string = mark.attrs.href;
  return mark.type.name === 'link' && piece.escaped && piece.node.text === href && BARE_URL.test(href)
    && (before === undefined || /\s/.test(before)) && (after === undefined || /\s/.test(after));
}

/** Text right after `]` would continue a function call if it starts with `(` or `.field`; escapes that. */
function guardCall(printedSoFar: string, text: string, escaped: boolean): string {
  return escaped && printedSoFar.endsWith(']') && /^(\(|\.\w)/.test(text) ? `\\${text}` : text;
}

function inlinePieces(block: Node, start: number): Piece[] {
  const pieces: Piece[] = [];
  let lineStart = true;
  block.forEach((child, offset) => {
    // only text can be code; atoms keep their own source
    const marks = child.marks.filter((m) => m.type.name in FORMATTING && (child.isText || m.type.name !== 'code'));
    const code = marks.some((m) => m.type.name === 'code');
    const original = code ? null : child.isText ? originalSource(child) : atomSource(child);
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
function printPiece(out: Printer, { escaped, code, node, pos }: Piece, text: string): void {
  if (code) return out.shown(text, 'text', pos, pos + node.nodeSize);
  if (!escaped) return out.shown(text, 'atom', pos, pos + node.nodeSize);
  let at = pos;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && i + 1 < text.length) out.hidden(text[i++]);
    out.shown(text[i], 'text', at, ++at);
  }
}

function spanEnd(pieces: Piece[], start: number, mark: Mark): number {
  let end = start;
  while (end + 1 < pieces.length && mark.isInSet(pieces[end + 1].marks)) end++;
  return end;
}

const WORD = /[\p{L}\p{N}_]/u;

function needsFunctionSyntax({ before, after, first, last }: Around): boolean {
  return (before !== undefined && WORD.test(before)) || (after !== undefined && WORD.test(after)) || /^\s/.test(first) || /\s$/.test(last);
}

/** The source an inline atom prints. */
function atomSource(atom: Node): string {
  if (atom.type.name === 'reference') return referenceSyntax(atom.attrs.target, atom.attrs.supplement);
  if (atom.type.name === 'marginNote') return printNoteCall(atom.attrs as { head: string; note: string });
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

// `label` is not printed from `src` but compared like an anchor: a renamed label updates the attribute in place
const ANCHORS = ['src', 'sep', 'marker', 'lead', 'trail', 'layout', 'label'];

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
