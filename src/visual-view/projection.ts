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
 * (`#link("url")[text]`, bare URLs) as a `link` mark, standalone
 * `#image("path", ..)` calls as `image` blocks (source kept like a raw block)
 * and `#table(columns: n, [..], ..)` with content cells as tables whose cells
 * hold blocks. `drafting` margin notes become a `marginNote` atom
 * (`#margin-note(..)[note]`) or, for `#margin-note(..)[text][note]`, a
 * `noteRange` mark over the projected text that holds the call and the note.
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
  return schema.nodes.doc.create(
    { lead: source.slice(0, segments[0].from), trail: source.slice(segments.at(-1)!.to) },
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
const PROSE = new Set(['Text', 'Strong', 'Emph', 'Escape', 'Shorthand', 'SmartQuote', 'Linebreak', 'Link']);
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
      if (segment.nodes.some((n) => PROSE.has(n.name) || isProseCall(ctx, n))) {
        return textblock(ctx, { type: 'paragraph', attrs: { src, sep } }, segment.from, inline(ctx, segment.nodes));
      }
      return blockCall(ctx, segment, sep) ?? ctx.schema.nodes.rawBlock.create({ src, sep });
  }
}

/** Calls that belong in running text: `link(..)`, which is prose like a bare URL, and margin notes. */
function isProseCall(ctx: Context, node: SyntaxNode): boolean {
  if (node.name !== 'FuncCall') return false;
  const { name } = callee(ctx, node);
  return name === 'link' || name === MARGIN_NOTE;
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

/** A run that is exactly one `#func(..)` call of a function modelled as a block (image, table). */
function blockCall(ctx: Context, segment: Segment, sep: string | null): Node | null {
  const [hash, call] = segment.nodes;
  if (segment.nodes.length !== 2 || hash.name !== 'Hash' || call.name !== 'FuncCall' || call.from !== hash.to) return null;
  const { name, args } = callee(ctx, call);
  const src = ctx.source.slice(segment.from, segment.to);
  if (name === 'image') return parenthesized(args) && imagePath(src) !== null ? ctx.schema.nodes.image.create({ src, sep }) : null;
  if (name === 'table') return table(ctx, segment, args, sep);
  return null;
}

/** How a table's source lies around its cells, for printing it back. */
interface TableLayout {
  columns: number;
  /** The source before, between and after the cells' content; one more than cells. */
  gaps: string[];
  /** Named arguments other than `columns`, as written. */
  named: string[];
}

/** `#table(columns: n, [..], ..)` whose positional arguments are all content blocks filling n columns. */
function table(ctx: Context, call: Segment, args: SyntaxNode[], sep: string | null): Node | null {
  const parsed = tableArgs(ctx, args);
  if (!parsed || parsed.cells.length === 0 || parsed.cells.length % parsed.columns !== 0) return null;
  const { schema, source } = ctx;
  const gaps: string[] = [];
  let pos = call.from;
  const cells = parsed.cells.map((block) => {
    const markup = block.getChild('Markup')!;
    const segments = segment(children(markup));
    const from = segments[0]?.from ?? markup.from;
    gaps.push(source.slice(pos, from));
    pos = segments.at(-1)?.to ?? markup.from;
    const content = segments.length > 0 ? blocks(ctx, segments) : [textblock(ctx, { type: 'paragraph', attrs: { src: '' } }, from, [])];
    return schema.nodes.tableCell.create(null, content);
  });
  gaps.push(source.slice(pos, call.to));
  const rows: Node[] = [];
  for (let i = 0; i < cells.length; i += parsed.columns) rows.push(schema.nodes.tableRow.create(null, cells.slice(i, i + parsed.columns)));
  const layout: TableLayout = { columns: parsed.columns, gaps, named: parsed.named };
  return schema.nodes.table.create({ sep, layout }, rows);
}

/** The arguments of a table call: an integer `columns`, other named arguments and closed content blocks only. */
function tableArgs(ctx: Context, args: SyntaxNode[]): { columns: number; named: string[]; cells: SyntaxNode[] } | null {
  if (!parenthesized(args)) return null;
  const result = { columns: 0, named: [] as string[], cells: [] as SyntaxNode[] };
  for (const arg of args.slice(1, -1)) {
    if (isClosedContent(arg)) result.cells.push(arg);
    else if (arg.name === 'Named') namedArg(ctx, arg, result);
    else if (arg.name !== 'Space' && arg.name !== 'Comma') return null;
  }
  return result.columns > 0 ? result : null;
}

/** Whether an argument list is `(..)` alone: closed, and no trailing content block. */
function parenthesized(args: SyntaxNode[]): boolean {
  return args[0]?.name === 'LeftParen' && args.at(-1)?.name === 'RightParen';
}

function isClosedContent(node: SyntaxNode): boolean {
  return node.name === 'ContentBlock' && node.lastChild?.name === 'RightBracket' && node.getChild('Markup') !== null;
}

function namedArg(ctx: Context, arg: SyntaxNode, into: { columns: number; named: string[] }): void {
  const name = arg.getChild('Ident');
  if (!name || ctx.source.slice(name.from, name.to) !== 'columns') {
    into.named.push(ctx.source.slice(arg.from, arg.to));
  } else if (arg.lastChild?.name === 'Int') {
    into.columns = Number(ctx.source.slice(arg.lastChild.from, arg.lastChild.to));
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
};

function inlineNode(context: InlineContext): Node | Placed[] {
  return (INLINE[context.node.name] ?? ((c: InlineContext) => raw(c.ctx, c.src, c.marks)))(context);
}

/**
 * Projects the expression after a `#`: `#link("url")[text]` becomes linked
 * text, a margin note a `marginNote` atom or `noteRange` text, anything else
 * a raw inline.
 */
function codeNode(context: InlineContext): Node | Placed[] {
  const modelled = context.node.name === 'FuncCall' && (linkCall(context) ?? marginNoteCall(context));
  return modelled || raw(context.ctx, context.src, context.marks);
}

const MARGIN_NOTE = 'margin-note';

/**
 * `#margin-note(..named)[note]` → a `marginNote` atom holding the call;
 * `#margin-note(..named)[text][note]` → `text` (one paragraph, not empty)
 * with a `noteRange` mark holding the source around it. Null for other forms.
 */
function marginNoteCall({ ctx, node, src, marks }: InlineContext): Node | Placed[] | null {
  const { name, args } = callee(ctx, node);
  if (name !== MARGIN_NOTE) return null;
  const blocks = trailingContent(args);
  if (!blocks) return null;
  if (blocks.length === 1) return ctx.schema.nodes.marginNote.create({ src }, null, marks);
  const [text, note] = blocks;
  const content = children(text.getChild('Markup')!);
  if (content.length === 0 || content.some((n) => n.name === 'Parbreak')) return null;
  const mark = ctx.schema.marks.noteRange.create({
    call: ctx.source.slice(node.from - 1, text.from),
    note: ctx.source.slice(note.firstChild!.to, note.lastChild!.from),
  });
  return inline(ctx, content, mark.addToSet(marks));
}

/** The one or two closed content blocks ending an argument list whose `(..)` part, if any, holds named arguments only. */
function trailingContent(args: SyntaxNode[]): SyntaxNode[] | null {
  const close = args.findIndex((a) => a.name === 'RightParen');
  const named = close < 0 ? [] : args.slice(1, close);
  if (close >= 0 && (args[0].name !== 'LeftParen' || !named.every((a) => ['Named', 'Comma', 'Space'].includes(a.name)))) return null;
  const blocks = args.slice(close + 1);
  const closed = blocks.every((b) => b.name === 'ContentBlock' && b.firstChild?.name === 'LeftBracket' && b.lastChild?.name === 'RightBracket');
  return closed && (blocks.length === 1 || (blocks.length === 2 && isClosedContent(blocks[0]))) ? blocks : null;
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

/** A Typst string literal's value, if it uses no escapes other than `\"` and `\\`. */
function decodeString(literal: string): string | null {
  return /^"(?:[^"\\\n]|\\["\\])*"$/.test(literal) ? literal.slice(1, -1).replace(/\\(["\\])/g, '$1') : null;
}

/** A Typst string literal with value `text`. */
function quote(text: string): string {
  return `"${text.replace(/["\\]/g, '\\$&')}"`;
}

/** The path of the image an `#image("path", ..)` call shows; null if it is not a call with a literal path. */
export function imagePath(src: string): string | null {
  const literal = /^#image\(\s*("(?:[^"\\\n]|\\.)*")/.exec(src);
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
    case 'image':
      return out.shown(node.attrs.src, 'atom', pos, pos + 1);
    case 'table':
      return printTable(out, node, pos);
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
  out.endBlock(pos, pos === start);
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
  out.endBlock(pos + block.nodeSize - 1, block.content.size === 0);
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

/** A table cell and the document position it starts at. */
interface PlacedCell {
  cell: Node;
  pos: number;
}

/**
 * A table: its source around unchanged cell content while it still has the
 * projected shape, so editing a cell changes just that cell; otherwise
 * `#table(columns: n, ..named, [..], ..)`, one row per line.
 */
function printTable(out: Printer, table: Node, pos: number): void {
  const rows: PlacedCell[][] = [];
  table.forEach((row, rowOffset) => {
    const cells: PlacedCell[] = [];
    row.forEach((cell, cellOffset) => cells.push({ cell, pos: pos + 1 + rowOffset + 1 + cellOffset }));
    rows.push(cells);
  });
  const layout: TableLayout | null = table.attrs.layout;
  const printCell = ({ cell, pos: cellPos }: PlacedCell) => printBlocks(out, cell, cellPos + 1, '\n\n');
  if (layout && hasShape(rows, layout)) {
    const cells = rows.flat();
    layout.gaps.forEach((gap, i) => {
      // the part up to `]` closes the previous cell, the rest opens the next one
      const close = i === 0 ? 0 : gap.indexOf(']') + 1;
      out.closing(gap.slice(0, close));
      out.hidden(gap.slice(close));
      if (i < cells.length) printCell(cells[i]);
    });
    return;
  }
  out.hidden(`#table(\n  columns: ${rows[0].length},\n`);
  for (const arg of layout?.named ?? []) out.hidden(`  ${arg},\n`);
  for (const row of rows) {
    row.forEach((cell, i) => {
      out.hidden(i === 0 ? '  [' : ', [');
      printCell(cell);
      out.closing(']');
    });
    out.hidden(',\n');
  }
  out.hidden(')');
}

/** Whether the table still has the rows and columns its source `layout` was made for. */
function hasShape(rows: unknown[][], { columns, gaps }: TableLayout): boolean {
  return rows.every((row) => row.length === columns) && rows.length * columns === gaps.length - 1;
}

/** Typst syntax around a formatted span, by mark: e.g. `*…*`, or `#strong[…]` where delimiters would not work. */
const FORMATTING: Record<string, (mark: Mark, around: Around) => { open: string; close: string }> = {
  bold: (_mark, around) => delimitedSyntax('*', 'strong', around),
  italic: (_mark, around) => delimitedSyntax('_', 'emph', around),
  link: (mark) => ({ open: `#link(${quote(mark.attrs.href)})[`, close: ']' }),
  noteRange: (mark) => ({ open: `${mark.attrs.call}[`, close: `][${mark.attrs.note}]` }),
};

/** What a formatted span starts and ends with, and the printed characters around it. */
interface Around {
  before: string | undefined;
  after: string | undefined;
  first: string;
  last: string;
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
  node: Node;
  pos: number;
}

/**
 * Prints inline content: each formatted span opens with its syntax (longer
 * spans outside), choosing `*x*` or `#strong[x]` so the result parses back
 * the same, and a link showing its own URL as a bare URL where Typst reads
 * it back as one.
 */
function printInline(out: Printer, block: Node, start: number): void {
  const pieces = inlinePieces(block, start);
  const open: { mark: Mark; close: string }[] = [];
  let printedSoFar = '';
  const hidden = (syntax: string) => {
    printedSoFar += syntax;
    out.hidden(syntax);
  };
  pieces.forEach((piece, i) => {
    const ended = open.findIndex((o) => !o.mark.isInSet(piece.marks));
    while (ended >= 0 && open.length > ended) hidden(open.pop()!.close);
    let text = piece.text;
    const opening = marksToOpen(pieces, i, open);
    opening.forEach(({ mark, end }, n) => {
      const around = { before: printedSoFar.at(-1), after: pieces[end + 1]?.text[0], first: piece.text, last: pieces[end].text };
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
    printedSoFar += text;
    printPiece(out, piece, text);
  });
  while (open.length > 0) hidden(open.pop()!.close);
}

/** The marks of `pieces[index]` not open yet, with the last piece they span; longer spans first. */
function marksToOpen(pieces: Piece[], index: number, open: { mark: Mark }[]): { mark: Mark; end: number }[] {
  return pieces[index].marks
    .filter((mark) => !open.some((o) => o.mark.eq(mark)))
    .map((mark) => ({ mark, end: spanEnd(pieces, index, mark) }))
    .sort((a, b) => b.end - a.end);
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
    const original = child.isText ? originalSource(child) : (child.attrs.src as string);
    const text = original ?? escapeMarkup(child.text!.replace(/\n/g, ' '), lineStart);
    const marks = child.marks.filter((m) => m.type.name in FORMATTING);
    pieces.push({ marks, text, escaped: original === null, node: child, pos: start + offset });
    lineStart = /\n\s*$/.test(text);
  });
  return pieces;
}

/** Prints `text`, which shows `node`: escaped text one character per position, its escaping backslashes hidden. */
function printPiece(out: Printer, { escaped, node, pos }: Piece, text: string): void {
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

const ANCHORS = ['src', 'sep', 'marker', 'lead', 'trail', 'layout'];

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
