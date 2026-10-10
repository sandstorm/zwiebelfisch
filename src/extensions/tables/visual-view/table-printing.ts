// Printing an edited table: its source around unchanged cells, or re-printed in the style it was written in.
// See visual-view.ts.
import type { Node } from '@tiptap/pm/model';
import { isEmbeddable } from '../../../core/typst-syntax/typst-syntax';
import type { Printer } from '../../../hosts/projection/projection';
import { NEW_TABLE, type TableLayout, type TableStyle } from '../model/table-layout';

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
export function printTable(out: Printer, table: Node, pos: number): void {
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
  out.blocks(cell, pos + 1, '\n\n');
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

/** Whether the table still has the rows, columns and header its source `layout` was made for. */
function hasShape(rows: PlacedCell[][], { columns, gaps, header }: TableLayout): boolean {
  return rows.every((row) => row.length === columns) && rows.length * columns === gaps.length - 1 && isHeaderRow(rows[0]) === header;
}

/** A row of header cells only (Tiptap's header row). */
function isHeaderRow(row: PlacedCell[]): boolean {
  return row.every(({ cell }) => cell.type.name === 'tableHeader');
}
