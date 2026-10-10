// Sheet values: what Typst reads of a spreadsheet — every sheet's cells as displayed, in `name.ic.json`. See spreadsheets.ts.

/** The part of IronCalc's `Model` the values need (also easy to fake in tests). */
export interface ValueSource {
  getWorksheetsProperties(): { name: string; state: string }[];
  getColumnsWithData(sheet: number, row: number): Int32Array | number[];
  getFormattedCellValue(sheet: number, row: number, column: number): string;
}

/** Rows looked at per sheet at most, and how many empty ones in a row end the search. */
const MAX_ROWS = 10_000;
const EMPTY_ROWS_TO_STOP = 1_000;

/**
 * Every visible sheet's cells as displayed (formulas computed, numbers
 * formatted as in the spreadsheet), by sheet name: rows from the first to the
 * last one with data, each as long as the widest row (empty cells are `""`),
 * starting at row 1 and column A. Typst reads it as `json("name.ic.json")`:
 * `data.Sheet1` is an array of rows, `data.Sheet1.at(1).at(0)` the cell A2.
 */
export function sheetValues(model: ValueSource): Record<string, string[][]> {
  const result: Record<string, string[][]> = {};
  model.getWorksheetsProperties().forEach((sheet, index) => {
    if (sheet.state === 'visible') result[sheet.name] = sheetRows(model, index);
  });
  return result;
}

function sheetRows(model: ValueSource, sheet: number): string[][] {
  const used: { row: number; columns: number[] }[] = [];
  let empty = 0;
  for (let row = 1; row <= MAX_ROWS && empty < EMPTY_ROWS_TO_STOP; row++) {
    const columns = [...model.getColumnsWithData(sheet, row)];
    empty = columns.length === 0 ? empty + 1 : 0;
    if (columns.length > 0) used.push({ row, columns });
  }
  if (used.length === 0) return [];
  const width = Math.max(...used.flatMap(({ columns }) => columns));
  const last = used.at(-1)!.row;
  const rows: string[][] = [];
  for (let row = 1; row <= last; row++) {
    rows.push(Array.from({ length: width }, (_, i) => model.getFormattedCellValue(sheet, row, i + 1)));
  }
  return rows;
}

/** Where the values of spreadsheet `path` go: `budget.ic` → `budget.ic.json`, next to it. */
export function valuesPath(path: string): string {
  return `${path}.json`;
}
