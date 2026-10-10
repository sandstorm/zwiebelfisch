// The Typst file of a spreadsheet: what Typst documents import of `name.ic` — every sheet as a table (displayed values,
// alignment, fills, fonts, borders, column widths, row heights) and as values — in `name.ic.gen.typ`. See spreadsheets.ts.
import type { CellStyle, Color } from '@ironcalc/wasm';

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
}

/** Rows looked at per sheet at most, and how many empty ones in a row end the search. */
const MAX_ROWS = 10_000;
const EMPTY_ROWS_TO_STOP = 1_000;
/** IronCalc's sizes are CSS pixels (96 per inch); Typst's points are 72 per inch. */
const PT_PER_PX = 0.75;
/** IronCalc's default row height (px) and font size: rows of that height stay `auto`, sizes are relative to it. */
const DEFAULT_ROW_HEIGHT = 25;
const DEFAULT_FONT_SIZE = 12;
/** `getCellType`: numbers align right, truth values and errors centered when the alignment is "general". */
const NUMBER = 1;
const BOOLEAN = 4;
const ERROR = 16;

/**
 * The Typst source for the spreadsheet `name` (shown in its header): two
 * dictionaries by sheet name, of every visible sheet.
 *
 * - `values`: the rows of displayed values (strings, formulas computed and
 *   numbers formatted as in the spreadsheet), from A1 to the last cell with
 *   data: `values.Sheet1.at(1).at(0)` is A2.
 * - `sheets`: the same cells as a `table`, with the spreadsheet's column
 *   widths, row heights (when not the default), alignment, fills, fonts
 *   (bold, italic, underline, strike, colour, relative size) and borders;
 *   hidden columns and rows are left out. The grid lines are Typst's table
 *   stroke (`#set table(stroke: …)` changes them).
 */
export function spreadsheetTypst(model: SheetSource, name: string): string {
  const sheets = model
    .getWorksheetsProperties()
    .map((sheet, index) => ({ name: sheet.name, index, visible: sheet.state === 'visible' }))
    .filter((sheet) => sheet.visible)
    .map((sheet) => ({ ...sheet, size: usedSize(model, sheet.index) }));
  const values = sheets.map(({ name, index, size }) => `  ${str(name)}: ${valueRows(model, index, size)},`);
  const tables = sheets.map(({ name, index, size }) => `  ${str(name)}: ${table(model, index, size)},`);
  return [
    `// Generated from ${name} on every edit of the spreadsheet: do not edit by hand.`,
    `// #import "${name}.gen.typ": sheets, values`,
    '// #sheets.Sheet1                  the sheet as a table',
    '// #values.Sheet1.at(1).at(0)      cell A2 as displayed (a string)',
    '',
    dictionary('values', values),
    '',
    dictionary('sheets', tables),
    '',
  ].join('\n');
}

/** Where the Typst file of spreadsheet `path` goes: `budget.ic` → `budget.ic.gen.typ`, next to it. */
// generic, so a ProjectPath stays one (a suffix keeps a path valid) without this file importing it: the demo's
// spreadsheet task runs it in Node, which resolves no extensionless imports
export function typstPath<Path extends string>(path: Path): Path {
  return `${path}.gen.typ` as Path;
}

interface Size {
  rows: number;
  columns: number;
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

const range = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

function dictionary(variable: string, entries: string[]): string {
  return entries.length === 0 ? `#let ${variable} = (:)` : `#let ${variable} = (\n${entries.join('\n')}\n)`;
}

function valueRows(model: SheetSource, sheet: number, { rows, columns }: Size): string {
  if (rows === 0) return '()';
  const lines = range(rows).map((row) => `    ${array(range(columns).map((column) => str(model.getFormattedCellValue(sheet, row, column))))},`);
  return `(\n${lines.join('\n')}\n  )`;
}

function table(model: SheetSource, sheet: number, { rows, columns }: Size): string {
  const shownColumns = range(columns).filter((column) => model.getColumnWidth(sheet, column) > 0);
  const shownRows = range(rows).filter((row) => model.getRowHeight(sheet, row) > 0);
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

const HORIZONTAL: Record<string, string> = { left: 'left', right: 'right', center: 'center', centerContinuous: 'center' };
const VERTICAL: Record<string, string> = { top: 'top', center: 'horizon', bottom: 'bottom' };

/** The Typst alignment of a cell: as formatted, else as spreadsheets show "general" (by type), bottom. */
function alignment(style: CellStyle, type: number): string {
  const general = type === NUMBER ? 'right' : type === BOOLEAN || type === ERROR ? 'center' : 'left';
  const horizontal = HORIZONTAL[style.alignment?.horizontal ?? 'general'] ?? general;
  const vertical = VERTICAL[style.alignment?.vertical ?? 'bottom'] ?? 'top';
  return `${horizontal} + ${vertical}`;
}

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

const BORDER_WIDTH: Record<string, number> = { thin: 0.75, dotted: 0.75, medium: 1.5, thick: 2.25, double: 2.25 };
const BORDER_DASH: Record<string, string> = {
  dotted: 'dotted',
  mediumdashed: 'dashed',
  mediumdashdot: 'dash-dotted',
  mediumdashdotdot: 'dash-dotted',
  slantdashdot: 'dash-dotted',
};

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

/** A spreadsheet colour as Typst `rgb(..)`; null when there is none. */
function color(model: SheetSource, value: Color): string | null {
  if (value === undefined) return null;
  const hex = model.resolveColor(value);
  return /^#[0-9a-f]{6}$/i.test(hex) ? `rgb("${hex.toLowerCase()}")` : null;
}

function pt(px: number): string {
  return `${round(px * PT_PER_PX)}pt`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** A Typst array literal (one element needs the trailing comma). */
function array(items: string[]): string {
  return items.length === 1 ? `(${items[0]},)` : `(${items.join(', ')})`;
}

/** A Typst string literal. */
function str(value: string): string {
  const escaped = value.replace(/[\\"\u0000-\u001f\u007f]/g, (char) => {
    const named: Record<string, string> = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' };
    return named[char] ?? `\\u{${char.charCodeAt(0).toString(16)}}`;
  });
  return `"${escaped}"`;
}
