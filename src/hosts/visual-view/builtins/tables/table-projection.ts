// Reading `#table(..)` calls: which ones the Visual view models as tables, their cells and how they are written.
// See tables.ts.
import type { SyntaxNode } from '@lezer/common';
import type { Node } from '@tiptap/pm/model';
import { children, isClosedContent, isEmbeddable, parenthesized, type Call, type ProjectionContext } from '../../projection/projection';
import { NEW_TABLE, type TableLayout, type TableStyle } from './table-layout';

/**
 * `#table(columns: n, ..)` (or `table(..)` as a figure's body) whose
 * positional arguments fill n columns, optionally starting with a one-row
 * `table.header(..)`. A cell is a content block `[..]` or an expression
 * (`ms(18)`, `$x^2$`), which becomes a raw box in a cell of its own.
 */
export function projectTable(p: ProjectionContext, call: Call, sep: string | null): Node | null {
  const parsed = tableArgs(p, call.args);
  if (!parsed || parsed.cells.length === 0 || parsed.cells.length % parsed.columns !== 0) return null;
  if (parsed.headerCells !== 0 && parsed.headerCells !== parsed.columns) return null;
  const style = tableStyle(p, call, parsed);
  if (!style) return null;
  const { schema, source } = p;
  const gaps: string[] = [];
  let pos = call.from;
  const cells = parsed.cells.map(({ node, bare }, index) => {
    const { content, from, to } = bare ? bareCell(p, node) : p.blocks(node);
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
function bareCell(p: ProjectionContext, node: SyntaxNode): { content: Node[]; from: number; to: number } {
  const src = p.text(node);
  const atom = p.schema.nodes.rawInline.create({ src, code: true });
  const paragraph = p.textblock({ type: 'paragraph', attrs: { src } }, node.from, [{ node: atom, from: node.from, to: node.to }]);
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
function tableStyle(p: ProjectionContext, call: Call, parsed: TableArgs): TableStyle | null {
  const text = (from: number, to: number) => p.source.slice(from, to);
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
function tableArgs(p: ProjectionContext, args: SyntaxNode[]): TableArgs | null {
  if (!parenthesized(args)) return null;
  const result: TableArgs = { columns: 0, columnsCount: null, named: [], cells: [], header: null, headerCells: 0 };
  for (const arg of args.slice(1, -1)) {
    if (arg.name === 'Space' || arg.name === 'Comma') continue;
    if (arg.name === 'Named') namedArg(p, arg, result);
    else if (!headerArg(p, arg, result)) {
      const cell = tableCell(p, arg);
      if (!cell) return null;
      result.cells.push(cell);
    }
  }
  return result.columns > 0 ? result : null;
}

/** Takes a `table.header(..)` of cells before any other cell as the header cells. */
function headerArg(p: ProjectionContext, arg: SyntaxNode, into: TableArgs): boolean {
  const target = arg.name === 'FuncCall' ? arg.firstChild : null;
  if (!target || p.text(target) !== 'table.header' || into.cells.length > 0) return false;
  const parts = children(arg.getChild('Args')!).filter((a) => !['LeftParen', 'RightParen', 'Space', 'Comma'].includes(a.name));
  const cells = parts.map((part) => tableCell(p, part));
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
function tableCell(p: ProjectionContext, arg: SyntaxNode): { node: SyntaxNode; bare: boolean } | null {
  if (isClosedContent(arg)) return { node: arg, bare: false };
  const src = p.text(arg);
  if (arg.name === 'ContentBlock' || /Comment/.test(arg.name) || /^table\s*\./.test(src)) return null;
  return isEmbeddable(src) ? { node: arg, bare: true } : null;
}

function namedArg(p: ProjectionContext, arg: SyntaxNode, into: TableArgs): void {
  const name = arg.getChild('Ident');
  if (!name || p.text(name) !== 'columns') {
    into.named.push(arg);
  } else if (arg.lastChild?.name === 'Int') {
    into.columns = Number(p.text(arg.lastChild));
    into.columnsCount = arg.lastChild;
  } else {
    into.columns = NaN;
  }
}
