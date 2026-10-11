// The Typst file of a spreadsheet (`name.ic.gen.typ`): what documents import of `name.ic`. See spreadsheets in
// ../spreadsheets.ts.
import type { CellStyle, Color } from '@ironcalc/wasm';

/**
 * The Typst source for the spreadsheet `name` (shown in its header): two
 * dictionaries by sheet name, of every visible sheet, and two by the
 * workbook's defined names.
 *
 * - `values`: the rows of displayed values (strings, formulas computed and
 *   numbers formatted as in the spreadsheet), from A1 to the last cell with
 *   data: `values.Sheet1.at(1).at(0)` is A2.
 * - `sheets`: the same cells as a `table`, with the spreadsheet's column
 *   widths, row heights (when not the default), alignment, fills, fonts
 *   (bold, italic, underline, strike, colour, relative size) and borders;
 *   hidden columns and rows are left out. The grid lines are Typst's table
 *   stroke (`#set table(stroke: …)` changes them).
 * - `names`: what a name refers to, as a document shows it: a cell's
 *   displayed value (a string, as in `values`), a range's cells as a table
 *   (as in `sheets`).
 * - `name-values`: the displayed values of a name: a cell's string, a
 *   range's rows (as in `values`).
 *
 * `namedAreas` says which names are there, and by which key.
 */
export function spreadsheetTypst(model: SheetSource, name: string): string {
  const all = model.getWorksheetsProperties();
  const sizes = new Map<number, Size>();
  const sizeOf = (sheet: number) => sizes.get(sheet) ?? sizes.set(sheet, usedSize(model, sheet)).get(sheet)!;
  const whole = (sheet: number): Area => ({ sheet, rows: range(sizeOf(sheet).rows), columns: range(sizeOf(sheet).columns) });
  const sheets = all.map((sheet, index) => ({ name: sheet.name, index, visible: sheet.state === 'visible' })).filter((sheet) => sheet.visible);
  const values = sheets.map(({ name, index }) => `  ${str(name)}: ${valueRows(model, whole(index))},`);
  const tables = sheets.map(({ name, index }) => `  ${str(name)}: ${table(model, whole(index))},`);
  const named = namedAreas(model, all.map((sheet) => sheet.name), sizeOf);
  const cellValue = ({ sheet, rows, columns }: Area) => str(model.getFormattedCellValue(sheet, rows[0], columns[0]));
  const names = named.map(({ key, cell, area }) => `  ${str(key)}: ${cell ? cellValue(area) : table(model, area)},`);
  const nameValues = named.map(({ key, cell, area }) => `  ${str(key)}: ${cell ? cellValue(area) : valueRows(model, area)},`);
  return [
    `// Generated from ${name} on every edit of the spreadsheet: do not edit by hand.`,
    `// #import "${name}.gen.typ": sheets, values, names, name-values`,
    '// #sheets.Sheet1                  the sheet as a table',
    '// #values.Sheet1.at(1).at(0)      cell A2 as displayed (a string)',
    '// #names.Total                    a named cell as displayed (a string)',
    '// #names.Budget                   a named range as a table',
    "// #name-values.Budget             a named range's displayed values, row by row",
    '// #names.at("Sheet1!Total")       a name defined for one sheet only',
    '',
    dictionary('values', values),
    '',
    dictionary('sheets', tables),
    '',
    dictionary('names', names),
    '',
    dictionary('name-values', nameValues),
    '',
  ].join('\n');
}

/** The part of IronCalc's `Model` the file needs. */
export interface SheetSource {
  getWorksheetsProperties(): { name: string; state: string }[];
  getColumnsWithData(sheet: number, row: number): Int32Array | number[];
  getFormattedCellValue(sheet: number, row: number, column: number): string;
  getCellType(sheet: number, row: number, column: number): number;
  getCellStyle(sheet: number, row: number, column: number): { style: CellStyle };
  getColumnWidth(sheet: number, column: number): number;
  getRowHeight(sheet: number, row: number): number;
  resolveColor(color: Color): string;
  getDefinedNameList(): { name: string; scope?: number; formula: string }[];
}

/** Where the Typst file of spreadsheet `path` goes: `budget.ic` → `budget.ic.gen.typ`, next to it. */
// generic, so a ProjectPath stays one (a suffix keeps a path valid) without this file importing it: the demo's
// spreadsheet task runs it in Node, which resolves no extensionless imports
export function typstPath<Path extends string>(path: Path): Path {
  return `${path}.gen.typ` as Path;
}

function usedSize(model: SheetSource, sheet: number): Size {
  let rows = 0;
  let columns = 0;
  for (let row = 1, empty = 0; row <= MAX_ROWS && empty < EMPTY_ROWS_TO_STOP; row++) {
    const used = [...model.getColumnsWithData(sheet, row)];
    empty = used.length === 0 ? empty + 1 : 0;
    if (used.length === 0) continue;
    rows = row;
    columns = Math.max(columns, ...used);
  }
  return { rows, columns };
}

interface Size {
  rows: number;
  columns: number;
}

/** Rows looked at per sheet at most, and how many empty ones in a row end the search. */
const MAX_ROWS = 10_000;
const EMPTY_ROWS_TO_STOP = 1_000;

/** A Typst string literal. */
function str(value: string): string {
  const escaped = value.replace(/[\\"\u0000-\u001f\u007f]/g, (char) => {
    const named: Record<string, string> = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
    return named[char] ?? `\\u{${char.charCodeAt(0).toString(16)}}`;
  });
  return `"${escaped}"`;
}

/**
 * The defined names that refer to a cell or a range, workbook-wide ones first. A workbook-wide name's key is the
 * name; a name of one sheet's is `Sheet!name`, as other sheets' formulas write it. A range keeps its part within the
 * sheet's cells with data (as `sheets` and `values`: whole columns end at the last row with data). Names of other
 * formulas (a constant, an expression, `#REF!`) are left out: IronCalc computes them only within a cell's formula.
 */
function namedAreas(model: SheetSource, sheetNames: string[], sizeOf: (sheet: number) => Size): NamedArea[] {
  const names = model.getDefinedNameList();
  const ordered = [...names.filter((name) => name.scope === undefined), ...names.filter((name) => name.scope !== undefined)];
  return ordered.flatMap(({ name, scope, formula }): NamedArea[] => {
    const reference = parseReference(formula);
    const sheet = reference ? sheetNames.indexOf(reference.sheet) : -1;
    if (!reference || sheet < 0 || (scope !== undefined && sheetNames[scope] === undefined)) return [];
    const key = scope === undefined ? name : `${sheetNames[scope]}!${name}`;
    const { top, left, bottom, right } = reference;
    if (top === bottom && left === right) return [{ key, cell: true, area: { sheet, rows: [top], columns: [left] } }];
    const { rows, columns } = sizeOf(sheet);
    return [{ key, cell: false, area: { sheet, rows: range(Math.min(bottom, rows), top), columns: range(Math.min(right, columns), left) } }];
  });
}

interface NamedArea {
  key: string;
  /** One cell (a string), else a range (a table, rows of values). */
  cell: boolean;
  area: Area;
}

/**
 * The cells a defined name's formula refers to: `Sheet1!$A$1`, `'Q1 2026'!$A$1:$C$4`, whole columns
 * (`Sheet1!$A:$B`: rows to Infinity) or rows (`Sheet1!$2:$3`); null for any other formula.
 */
function parseReference(formula: string): Reference | null {
  const [, quoted, plain, cells] = SHEET_AND_CELLS.exec(formula) ?? [];
  if (!cells || !CELLS.test(cells)) return null;
  const [from, to = from] = cells.split(':');
  const start = corner(from, 1);
  const end = corner(to, Infinity);
  return {
    sheet: quoted?.replaceAll("''", "'") ?? plain,
    top: Math.min(start.row, end.row),
    bottom: Math.max(start.row, end.row),
    left: Math.min(start.column, end.column),
    right: Math.max(start.column, end.column),
  };
}

/** A corner of `CELLS` (`$A$1`, `B`, `3`): what it leaves out is `missing` (the first or the last). */
function corner(text: string, missing: number): { row: number; column: number } {
  const [, letters, digits] = /^\$?([A-Z]*)\$?(\d*)$/i.exec(text)!;
  return { column: letters ? columnNumber(letters) : missing, row: digits ? Number(digits) : missing };
}

interface Reference {
  sheet: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** A sheet (`'…'` quoted, `''` an apostrophe), `!` and what follows. */
const SHEET_AND_CELLS = /^(?:'((?:[^']|'')+)'|([^'!]+))!(.+)$/;
/** A cell or range, whole columns or whole rows; `$` optional. */
const CELLS = /^(?:\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?|\$?[A-Z]+:\$?[A-Z]+|\$?\d+:\$?\d+)$/i;

/** `A` → 1, `Z` → 26, `AA` → 27. */
function columnNumber(letters: string): number {
  return [...letters.toUpperCase()].reduce((number, letter) => number * 26 + letter.charCodeAt(0) - 64, 0);
}

/** Cells of a sheet: `rows` × `columns` (numbers from 1, in order). */
interface Area {
  sheet: number;
  rows: number[];
  columns: number[];
}

function valueRows(model: SheetSource, { sheet, rows, columns }: Area): string {
  if (rows.length === 0 || columns.length === 0) return '()';
  const lines = rows.map((row) => `    ${array(columns.map((column) => str(model.getFormattedCellValue(sheet, row, column))))},`);
  return `(\n${lines.join('\n')}\n  )`;
}

/** The numbers `from` … `to` (none when `to` is smaller). */
const range = (to: number, from = 1) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

/** A Typst array literal (one element needs the trailing comma). */
function array(items: string[]): string {
  return items.length === 1 ? `(${items[0]},)` : `(${items.join(', ')})`;
}

function table(model: SheetSource, { sheet, rows, columns }: Area): string {
  const shownColumns = columns.filter((column) => model.getColumnWidth(sheet, column) > 0);
  const shownRows = rows.filter((row) => model.getRowHeight(sheet, row) > 0);
  if (shownColumns.length === 0 || shownRows.length === 0) return '[]';
  const widths = shownColumns.map((column) => pt(model.getColumnWidth(sheet, column)));
  const heights = shownRows.map((row) => model.getRowHeight(sheet, row));
  const lines = [`columns: ${array(widths)},`];
  if (heights.some((height) => height !== DEFAULT_ROW_HEIGHT)) {
    lines.push(`rows: ${array(heights.map((height) => (height === DEFAULT_ROW_HEIGHT ? 'auto' : pt(height))))},`);
  }
  lines.push('align: left + bottom,');
  for (const row of shownRows) for (const column of shownColumns) lines.push(`${cell(model, sheet, row, column)},`);
  return `table(\n${lines.map((line) => `    ${line}`).join('\n')}\n  )`;
}

function pt(px: number): string {
  return `${round(px * PT_PER_PX)}pt`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** IronCalc's sizes are CSS pixels (96 per inch); Typst's points are 72 per inch. */
const PT_PER_PX = 0.75;
/** IronCalc's default row height (px) and font size: rows of that height stay `auto`, sizes are relative to it. */
const DEFAULT_ROW_HEIGHT = 25;

function cell(model: SheetSource, sheet: number, row: number, column: number): string {
  const { style } = model.getCellStyle(sheet, row, column);
  const options: string[] = [];
  const align = alignment(style, model.getCellType(sheet, row, column));
  if (align !== 'left + bottom') options.push(`align: ${align}`);
  const fill = color(model, style.fill.color);
  if (fill) options.push(`fill: ${fill}`);
  const stroke = borders(model, style);
  if (stroke) options.push(`stroke: ${stroke}`);
  const body = text(model, style, str(model.getFormattedCellValue(sheet, row, column)));
  return options.length === 0 ? body : `table.cell(${[...options, body].join(', ')})`;
}

/** The Typst alignment of a cell: as formatted, else as spreadsheets show "general" (by type), bottom. */
function alignment(style: CellStyle, type: number): string {
  const general = type === NUMBER ? 'right' : type === BOOLEAN || type === ERROR ? 'center' : 'left';
  const horizontal = HORIZONTAL[style.alignment?.horizontal ?? 'general'] ?? general;
  const vertical = VERTICAL[style.alignment?.vertical ?? 'bottom'] ?? 'top';
  return `${horizontal} + ${vertical}`;
}

/** `getCellType`: numbers align right, truth values and errors centered when the alignment is "general". */
const NUMBER = 1;
const BOOLEAN = 4;
const ERROR = 16;

const HORIZONTAL: Record<string, string> = { left: 'left', right: 'right', center: 'center', centerContinuous: 'center' };
const VERTICAL: Record<string, string> = { top: 'top', center: 'horizon', bottom: 'bottom' };

/** A spreadsheet colour as Typst `rgb(..)`; null when there is none. */
function color(model: SheetSource, value: Color): string | null {
  if (value === undefined) return null;
  const hex = model.resolveColor(value);
  return /^#[0-9a-f]{6}$/i.test(hex) ? `rgb("${hex.toLowerCase()}")` : null;
}

/** The cell's borders as a Typst stroke dictionary (empty: none). */
function borders(model: SheetSource, { border }: CellStyle): string {
  const sides = (['left', 'right', 'top', 'bottom'] as const).flatMap((side) => {
    const item = border[side];
    if (!item) return [];
    const thickness = `${BORDER_WIDTH[item.style] ?? 1.5}pt`;
    const paint = color(model, item.color) ?? 'black';
    const dash = BORDER_DASH[item.style];
    return [`${side}: ${dash ? `(thickness: ${thickness}, paint: ${paint}, dash: "${dash}")` : `${thickness} + ${paint}`}`];
  });
  return sides.length === 0 ? '' : `(${sides.join(', ')})`;
}

const BORDER_WIDTH: Record<string, number> = { thin: 0.75, dotted: 0.75, medium: 1.5, thick: 2.25, double: 2.25 };
const BORDER_DASH: Record<string, string> = {
  dotted: 'dotted',
  mediumdashed: 'dashed',
  mediumdashdot: 'dash-dotted',
  mediumdashdotdot: 'dash-dotted',
  slantdashdot: 'dash-dotted',
};

function text(model: SheetSource, style: CellStyle, body: string): string {
  const { font } = style;
  const options: string[] = [];
  if (font.b) options.push('weight: "bold"');
  if (font.i) options.push('style: "italic"');
  const fill = color(model, font.color);
  if (fill) options.push(`fill: ${fill}`);
  if (font.sz && font.sz !== DEFAULT_FONT_SIZE) options.push(`size: ${round(font.sz / DEFAULT_FONT_SIZE)}em`);
  let result = options.length === 0 ? body : `text(${[...options, body].join(', ')})`;
  if (font.strike) result = `strike(${result})`;
  if (font.u) result = `underline(${result})`;
  return result;
}

const DEFAULT_FONT_SIZE = 12;

function dictionary(variable: string, entries: string[]): string {
  return entries.length === 0 ? `#let ${variable} = (:)` : `#let ${variable} = (\n${entries.join('\n')}\n)`;
}
