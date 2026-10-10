// How a table's source lies around its cells: what projecting records and printing keeps. See model.ts.

/** How a table's source lies around its cells, for printing it back. */
export interface TableLayout {
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
export interface TableStyle {
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
export const NEW_TABLE: TableStyle = {
  head: ['#table(\n  columns: ', ',\n  '],
  named: [],
  cellSep: ', ',
  rowSep: ',\n  ',
  header: { open: 'table.header(', sep: ', ', close: ')' },
  tail: ',\n)',
};
