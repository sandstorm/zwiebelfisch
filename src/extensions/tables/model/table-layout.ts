// How a table's source lies around its cells: what parsing records and printing keeps. See tables in ../tables.ts.

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
  /** The source from the call to the first row, around the `columns` value. */
  head: [string, string];
  /** `columns` written as an array of track sizes; null for a count. */
  tracks: TrackSizes | null;
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

/**
 * `columns: (auto, 2fr, 1fr)`: one entry per column, any expression, kept as written. Every cell carries its
 * column's entry (its `track` attribute), so the entries follow the columns added and deleted in the editor.
 */
export interface TrackSizes {
  /** The array's source, printed while the columns still have `entries`. */
  source: string;
  entries: string[];
  /** Around and between the entries: `(`, `, `, `)`; without the comma a single entry needs (`(1fr,)`). */
  open: string;
  sep: string;
  close: string;
}

/** The style of a table made in the editor: `#table(\n  columns: n,\n  [..], [..],\n)`. */
export const NEW_TABLE: TableStyle = {
  head: ['#table(\n  columns: ', ',\n  '],
  tracks: null,
  named: [],
  cellSep: ', ',
  rowSep: ',\n  ',
  header: { open: 'table.header(', sep: ', ', close: ')' },
  tail: ',\n)',
};

/**
 * The `columns` value of columns with `entries` (their cells' `track`; null for a column added in the editor): the
 * count, or the array as written while the columns have its entries, or else the entries in the array's style. An
 * added column gets `1fr` if every other entry is a fraction (the columns share the width; so does the new one),
 * else `auto`.
 */
export function columnsSource(tracks: TrackSizes | null, entries: (string | null)[]): string {
  if (!tracks) return String(entries.length);
  if (sameEntries(entries, tracks)) return tracks.source;
  const added = entries.every((entry) => entry === null || FRACTION.test(entry)) ? '1fr' : 'auto';
  const written = entries.map((entry) => entry ?? added);
  // `(1fr)` would be `1fr` in parentheses, not an array
  const close = written.length === 1 && !tracks.close.trimStart().startsWith(',') ? `,${tracks.close}` : tracks.close;
  return tracks.open + written.join(tracks.sep) + close;
}

/** Whether columns with `entries` (their cells' `track`) are the ones `columns` was written for: all null for a count. */
export function sameEntries(entries: (string | null)[], tracks: TrackSizes | null): boolean {
  return entries.every((entry, i) => entry === (tracks ? tracks.entries[i] : null)) && (!tracks || entries.length === tracks.entries.length);
}

/** A fraction track size: `1fr`, `2.5fr`. */
const FRACTION = /^(\d+(\.\d*)?|\.\d+)fr$/;
