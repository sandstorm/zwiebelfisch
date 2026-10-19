// Tests for sheet-figure.ts: the starter table (against IronCalc's real engine and, compiled, the Typst engine) and
// the figure with its import; the spreadsheet a dropped file stands for, and its first sheet.
import { readFileSync } from 'node:fs';
import init, { Model } from '@ironcalc/wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { SourceOffset, type TextChange } from '../../../core/typst-document/typst-document';
import { createEngine } from '../../../core/typst-engine/typst-engine';
import { calculateSheetFigure, droppedSpreadsheet, firstSheet, typeStarterTable } from './sheet-figure';
import { spreadsheetTypst } from './typst-file';

beforeAll(async () => {
  await init({ module_or_path: readFileSync(new URL('../../../../node_modules/@ironcalc/wasm/wasm_bg.wasm', import.meta.url)) });
});

const path = ProjectPath.of;
const apply = (text: string, change: TextChange | null) => (change ? text.slice(0, change.from) + change.insert + text.slice(change.to) : text);

/** The figure of `Sheet1` of `spreadsheet` used at the end of `text` in `/main.typ` (or `file`), with its import applied. */
function figure(text: string, spreadsheet: string, file = '/main.typ') {
  const { source, importChange } = calculateSheetFigure(text, { file: path(file), spreadsheet: path(spreadsheet), sheet: 'Sheet1', use: SourceOffset.of(text.length) });
  return { source, text: apply(text, importChange), changed: importChange !== null };
}

describe('typeStarterTable', () => {
  it('fills a header row and two rows, so the new spreadsheet compiles as a figure at once', async () => {
    const model = new Model('table', 'en', 'UTC', 'en');
    typeStarterTable(model);
    const typst = spreadsheetTypst(model, 'table.ic');
    expect(typst).toContain('("Item", "Value"),\n    ("First", "1"),\n    ("Second", "2"),');
    expect(typst).toContain('text(weight: "bold", "Item")');

    const engine = await createEngine(readFileSync(new URL('../../../core/typst-engine/wasm.gen/typst_engine_bg.wasm', import.meta.url)));
    engine.addFont(readFileSync(new URL('../../../core/typst-engine/fonts.gen/LibertinusSerif-Regular.otf', import.meta.url)));
    engine.setSource('/data/table.ic.gen.typ', typst);
    const { source, text } = figure('= Results\n', '/data/table.ic');
    engine.setSource('/main.typ', `${text}\n${source}\n`);
    expect(engine.compile('/main.typ').diagnostics).toEqual([]);
  });
});

describe('calculateSheetFigure', () => {
  it('imports `sheets` from the Typst file at the top, written relative to the document, a blank line after it', () => {
    expect(figure('= Results\n', '/data/table.ic')).toEqual({
      source: '#figure(sheets.Sheet1, caption: [ ])',
      text: '#import "data/table.ic.gen.typ": sheets\n\n= Results\n',
      changed: true,
    });
    expect(figure('Text\n', '/data/table.ic', '/chapters/results.typ').text).toBe('#import "/data/table.ic.gen.typ": sheets\n\nText\n');
  });

  it("uses the document's import of the file as it is, or adds `sheets` to it", () => {
    expect(figure('#import "data/table.ic.gen.typ": values, sheets as runs\n', '/data/table.ic')).toMatchObject({ source: '#figure(runs.Sheet1, caption: [ ])', changed: false });
    expect(figure('#import "data/table.ic.gen.typ": *\n', '/data/table.ic')).toMatchObject({ source: '#figure(sheets.Sheet1, caption: [ ])', changed: false });
    expect(figure('#import "data/table.ic.gen.typ": values\n', '/data/table.ic').text).toBe('#import "data/table.ic.gen.typ": values, sheets\n');
  });

  it("names a second spreadsheet's tables after its file when `sheets` is taken", () => {
    const one = '#import "data/runs.ic.gen.typ": sheets\n';
    expect(figure(one, '/data/table.ic')).toEqual({
      source: '#figure(table-sheets.Sheet1, caption: [ ])',
      text: `#import "data/table.ic.gen.typ": sheets as table-sheets\n${one}`,
      changed: true,
    });
    // another spreadsheet's file imported with `*` binds `sheets` as well; a taken name is numbered
    expect(figure('#import "runs.ic.gen.typ": *\n#import "x.typ": table-sheets\n', '/table.ic').source).toBe('#figure(table-sheets-2.Sheet1, caption: [ ])');
    expect(figure(one, '/data/2026 Q1.ic').source).toBe('#figure(sheet-2026-Q1-sheets.Sheet1, caption: [ ])');
  });

  it('reaches a sheet whose name is no identifier with `at`', () => {
    const { source } = calculateSheetFigure('', { file: path('/main.typ'), spreadsheet: path('/t.ic'), sheet: 'Q1 2026', use: SourceOffset.of(0) });
    expect(source).toBe('#figure(sheets.at("Q1 2026"), caption: [ ])');
  });
});

describe('a spreadsheet dropped into a document', () => {
  it('stands for the spreadsheet itself or for that of its Typst file; other files for none', () => {
    expect(droppedSpreadsheet(path('/data/budget.ic'))).toBe('/data/budget.ic');
    expect(droppedSpreadsheet(path('/data/budget.ic.gen.typ'))).toBe('/data/budget.ic');
    expect(droppedSpreadsheet(path('/data/Budget.IC'))).toBe('/data/Budget.IC');
    expect(droppedSpreadsheet(path('/chapter.typ'))).toBeNull();
    expect(droppedSpreadsheet(path('/topic'))).toBeNull();
  });

  it('shows the first sheet of its Typst file, its name as written there; none without sheets', () => {
    const model = new Model('table', 'en', 'UTC', 'en');
    model.newSheet();
    model.renameSheet(0, 'Q1 "2026"');
    expect(firstSheet(spreadsheetTypst(model, 'table.ic'))).toBe('Q1 "2026"');
    expect(firstSheet('#let values = (:)\n\n#let sheets = (:)\n')).toBeNull();
  });
});
