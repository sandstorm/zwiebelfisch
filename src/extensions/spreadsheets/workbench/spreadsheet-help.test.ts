// Tests for spreadsheet-help.ts: its formulas against IronCalc's real engine, its Typst against a spreadsheet's real
// Typst file and the Typst engine.
import { readFileSync } from 'node:fs';
import init, { Model } from '@ironcalc/wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createEngine } from '../../../core/typst-engine/typst-engine';
import { spreadsheetTypst } from '../model/typst-file';
import { SPREADSHEET_HELP } from './spreadsheet-help';

beforeAll(async () => {
  await init({ module_or_path: readFileSync(new URL('../../../../node_modules/@ironcalc/wasm/wasm_bg.wasm', import.meta.url)) });
});

const [formulas, references, inTheDocument] = SPREADSHEET_HELP.sections;

/** A workbook with numbers in A1:B20 of `Sheet1`, `Sheet2` and `Q1 2026`; the names `Total` (B20) and `Costs` (B1:B20). */
function workbook(): Model {
  const model = new Model('table', 'en', 'UTC', 'en');
  model.newSheet();
  model.newSheet();
  model.renameSheet(2, 'Q1 2026');
  for (const sheet of [0, 1, 2]) for (let row = 1; row <= 20; row++) for (const column of [1, 2]) model.setUserInput(sheet, row, column, String(row * column));
  model.newDefinedName('Total', undefined, 'Sheet1!$B$20');
  model.newDefinedName('Costs', undefined, 'Sheet1!$B$1:$B$20');
  return model;
}

/** What `formula` shows in a cell of `workbook()`'s first sheet. */
function computed(formula: string): string {
  const model = workbook();
  model.setUserInput(0, 30, 3, formula);
  model.evaluate();
  return model.getFormattedCellValue(0, 30, 3);
}

describe('the spreadsheet help sheet', () => {
  it.each([...formulas.rows, ...references.rows].map((row) => [row.snippet]))('%s computes in IronCalc', (formula) => {
    expect(computed(formula)).not.toMatch(/^#/);
  });

  it('(a formula IronCalc cannot compute shows an error)', () => {
    expect(computed('=Sheet9!A1')).toMatch(/^#/);
  });

  it('its Typst compiles against the Typst file of a spreadsheet', async () => {
    const engine = await createEngine(readFileSync(new URL('../../../core/typst-engine/wasm/typst_engine_bg.wasm', import.meta.url)));
    engine.addFont(readFileSync(new URL('../../../core/typst-engine/fonts/LibertinusSerif-Regular.otf', import.meta.url)));
    engine.setSource('/table.ic.gen.typ', spreadsheetTypst(workbook(), 'table.ic'));
    engine.setSource('/main.typ', `${inTheDocument.rows.map((row) => row.snippet).join('\n\n')}\n`);
    expect(engine.compile('/main.typ').diagnostics).toEqual([]);
  });
});
