// The spreadsheets extension's model: a spreadsheet's Typst file (typst-file.ts) and IronCalc's dark palette
// (dark-theme.ts). Pure: no DOM, no editor library. Entry of extensions/spreadsheets/model/. See ../spreadsheets.ts.
export { type SheetSource, spreadsheetTypst, typstPath } from './typst-file';
export { type ColorToken, darkThemeVariables } from './dark-theme';
