// Reading `#table(..)` calls: which ones the Visual editor models as tables, their cells and how they are written.
// See tables in ../tables.ts.
import type { SyntaxNode } from '@lezer/common';
import type { Node } from '@tiptap/pm/model';
import { callArguments, children, hasOnlyArguments, isClosedContent, isEmbeddable, trailingContent, withHash } from '../../../core/typst-syntax/typst-syntax';
import type { TypstParseContext } from '../../../hosts/prosemirror-typst/prosemirror-typst';
import { NEW_TABLE, type TableLayout, type TableStyle, type TrackSizes } from '../model/table-layout';

/**
 * `#table(columns: n, ..)` or `#table(columns: (auto, 1fr, ..), ..)` (or
 * `table(..)` as a figure's body) whose positional arguments fill the
 * columns, optionally starting with a one-row
 * `table.header(..)`. A cell is a content block `[..]` or an expression
 * (`ms(18)`, `$x^2$`), which becomes a raw box in a cell of its own.
 */
export function parseTable(p: TypstParseContext, call: SyntaxNode, sep: string | null): Node | null {
  const parsed = tableArgs(p, call);
  if (!parsed || parsed.cells.length === 0 || parsed.cells.length % parsed.columns !== 0) return null;
  if (parsed.headerCells !== 0 && parsed.headerCells !== parsed.columns) return null;
  const range = withHash(call);
  const style = tableStyle(p, range, parsed);
  if (!style) return null;
  const { schema, source } = p;
  const gaps: string[] = [];
  let pos: number = range.from;
  const cells = parsed.cells.map(({ node, bare }, index) => {
    const { content, from, to } = bare ? bareCell(p, node) : p.blocks(node);
    gaps.push(source.slice(pos, from));
    pos = to;
    const track = style.tracks?.entries[index % parsed.columns] ?? null;
    return (index < parsed.headerCells ? schema.nodes.tableHeader : schema.nodes.tableCell).create({ track }, content);
  });
  gaps.push(source.slice(pos, range.to));
  const rows: Node[] = [];
  for (let i = 0; i < cells.length; i += parsed.columns) rows.push(schema.nodes.tableRow.create(null, cells.slice(i, i + parsed.columns)));
  const bare = parsed.cells.map((c) => c.bare);
  const layout: TableLayout = { columns: parsed.columns, gaps, bare, header: parsed.headerCells > 0, style };
  return schema.nodes.table.create({ sep, layout }, rows);
}

/**
 * The arguments of a table call: `columns` (an integer or an array), other named arguments
 * and cells only (see `tableCell`), the first of them optionally in a
 * `table.header(..)`.
 */
function tableArgs(p: TypstParseContext, call: SyntaxNode): TableArgs | null {
  if (!hasOnlyArguments(call)) return null;
  const result: TableArgs = { columns: 0, columnsValue: null, named: [], cells: [], header: null, headerCells: 0 };
  for (const arg of callArguments(call)) {
    if (arg.name === 'Named') namedArg(p, arg, result);
    else if (!headerArg(p, arg, result)) {
      const cell = tableCell(p, arg);
      if (!cell) return null;
      result.cells.push(cell);
    }
  }
  return result.columns > 0 ? result : null;
}

interface TableArgs {
  columns: number;
  /** The `columns` integer or array. */
  columnsValue: SyntaxNode | null;
  /** Named arguments other than `columns`. */
  named: SyntaxNode[];
  /** The cells, the header's first: content blocks, or bare expressions. */
  cells: { node: SyntaxNode; bare: boolean }[];
  /** The `table.header(..)` call, if any, and how many of the cells are in it. */
  header: SyntaxNode | null;
  headerCells: number;
}

function namedArg(p: TypstParseContext, arg: SyntaxNode, into: TableArgs): void {
  const name = arg.getChild('Ident');
  const value = arg.lastChild;
  if (!name || p.text(name) !== 'columns') {
    into.named.push(arg);
  } else if (value?.name === 'Int' || value?.name === 'Array') {
    into.columns = value.name === 'Int' ? Number(p.text(value)) : (trackEntries(value)?.length ?? NaN);
    into.columnsValue = value;
  } else {
    into.columns = NaN;
  }
}

/** The entries of `(a, b, ..)`, at least one: no spread (`..xs`), no comments; null otherwise. */
function trackEntries(array: SyntaxNode): SyntaxNode[] | null {
  const parts = children(array).slice(1, -1);
  const entries = parts.filter((part) => part.name !== 'Comma' && part.name !== 'Space');
  const plain = entries.every((entry) => entry.name !== 'Spread' && !/Comment/.test(entry.name) && !entry.type.isError);
  return array.lastChild?.name === 'RightParen' && entries.length > 0 && plain ? entries : null;
}

/** Takes a `table.header(..)` of cells before any other cell as the header cells. */
function headerArg(p: TypstParseContext, arg: SyntaxNode, into: TableArgs): boolean {
  const target = arg.name === 'FuncCall' ? arg.firstChild : null;
  if (!target || p.text(target) !== 'table.header' || into.cells.length > 0) return false;
  // `table.header([a], [b])` or `table.header[a][b]`
  const trailing = trailingContent(arg);
  const cells = trailing ? [...callArguments(arg), ...trailing].map((part) => tableCell(p, part)) : [];
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
function tableCell(p: TypstParseContext, arg: SyntaxNode): { node: SyntaxNode; bare: boolean } | null {
  if (isClosedContent(arg)) return { node: arg, bare: false };
  const src = p.text(arg);
  if (arg.name === 'ContentBlock' || /Comment/.test(arg.name) || /^table\s*\./.test(src)) return null;
  return isEmbeddable(src) ? { node: arg, bare: true } : null;
}

/**
 * How the table's rows are written: the source before the first row (with
 * the `columns` value cut out), its track sizes, the separators of its last rows, the header
 * call's syntax and what follows the last row. Null if `columns` comes after
 * the first row.
 */
function tableStyle(p: TypstParseContext, call: { from: number; to: number }, parsed: TableArgs): TableStyle | null {
  const text = (from: number, to: number) => p.source.slice(from, to);
  const between = (a: SyntaxNode | undefined, b: SyntaxNode | undefined) => (a && b ? text(a.to, b.from) : null);
  const cells = parsed.cells.map((c) => c.node);
  const rows: SyntaxNode[][] = parsed.header ? [[parsed.header]] : [];
  for (let i = parsed.headerCells; i < cells.length; i += parsed.columns) rows.push(cells.slice(i, i + parsed.columns));
  const first = rows[0][0];
  const last = rows.at(-1)!.at(-1)!;
  const value = parsed.columnsValue!;
  if (value.to > first.from) return null;
  const lastRow = rows.at(-1)!;
  const sepOf = (s: string | null, fallback: string) => (s !== null && ARG_SEP.test(s) ? s : fallback);
  const cellSep = sepOf(lastRow === rows[0] && parsed.header ? null : between(lastRow[0], lastRow[1]), NEW_TABLE.cellSep);
  const indent = /\s*$/.exec(text(call.from, first.from))![0];
  const rowSep = sepOf(between(rows.at(-2)?.at(-1), lastRow[0]), indent.includes('\n') ? `,${indent}` : cellSep);
  return {
    head: [text(call.from, value.from), text(value.to, first.from)],
    tracks: value.name === 'Array' ? trackSizes(text, value) : null,
    named: parsed.named.filter((n) => n.from > first.from && n.to <= last.from).map((n) => text(n.from, n.to)),
    cellSep,
    rowSep,
    header: parsed.header ? headerStyle(text, parsed.header, cells.slice(0, parsed.headerCells), cellSep) : { ...NEW_TABLE.header, sep: cellSep },
    tail: text(last.to, call.to),
  };
}

/** Separators between table arguments: a comma and whitespace, nothing else (no comments). */
const ARG_SEP = /^\s*,\s*$/;

/**
 * How `columns: (..)` (an `Array` of plain entries, see `trackEntries`) is written. Between entries the array's first
 * separator, or after a single entry the line break before it, if any.
 */
function trackSizes(text: (from: number, to: number) => string, array: SyntaxNode): TrackSizes {
  const entries = trackEntries(array)!;
  const open = text(array.from, entries[0].from);
  const indent = /\s*$/.exec(open)![0];
  const sep = entries.length > 1 ? text(entries[0].to, entries[1].from) : indent.includes('\n') ? `,${indent}` : ', ';
  const close = text(entries.at(-1)!.to, array.to);
  return {
    source: text(array.from, array.to),
    entries: entries.map((entry) => text(entry.from, entry.to)),
    open,
    sep,
    close: entries.length === 1 ? close.replace(/^(\s*),/, '$1') : close,
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

/** A cell written as an expression: a paragraph holding it as a raw box (code, without `#`). */
function bareCell(p: TypstParseContext, node: SyntaxNode): { content: Node[]; from: number; to: number } {
  const src = p.text(node);
  const atom = p.schema.nodes.rawInline.create({ src, code: true });
  const paragraph = p.textblock({ type: 'paragraph', attrs: { src } }, node.from, [{ node: atom, from: node.from, to: node.to }]);
  return { content: [paragraph], from: node.from, to: node.to };
}
