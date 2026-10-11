// Tests for typst-file.ts, against IronCalc's real engine (wasm) and, for the generated source, the Typst engine.
import { readFileSync } from 'node:fs';
import init, { Model } from '@ironcalc/wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createEngine } from '../../../core/typst-engine/typst-engine';
import { spreadsheetPath, spreadsheetTypst, typstPath } from './typst-file';

beforeAll(async () => {
  await init({ module_or_path: readFileSync(new URL('../../../../node_modules/@ironcalc/wasm/wasm_bg.wasm', import.meta.url)) });
});

/** A new workbook with `cells` (by "A1" style address, on the first sheet) typed in. */
function workbook(cells: Record<string, string> = {}): Model {
  const model = new Model('budget', 'en', 'UTC', 'en');
  for (const [address, input] of Object.entries(cells)) {
    const [, column, row] = /^([A-Z])(\d+)$/.exec(address)!;
    model.setUserInput(0, Number(row), column.charCodeAt(0) - 64, input);
  }
  model.evaluate();
  return model;
}

function style(model: Model, address: string, path: string, value: string): void {
  const [, column, row] = /^([A-Z])(\d+)$/.exec(address)!;
  model.updateRangeStyle({ sheet: 0, row: Number(row), column: column.charCodeAt(0) - 64, width: 1, height: 1 }, path, value);
}

describe('spreadsheetTypst', () => {
  it('says where it comes from and how to use it', () => {
    const source = spreadsheetTypst(workbook(), 'budget.ic');
    expect(source).toMatch(/^\/\/ Generated from budget\.ic \(next to this file\) on every edit of the spreadsheet: edit budget\.ic, not this file\.\n/);
    expect(source).toContain('#import "budget.ic.gen.typ": sheets, values');
  });

  it('gives every visible sheet its displayed values, from A1 to the last cell with data', () => {
    const model = workbook({ A1: 'Item', B1: 'Cost', A2: 'Rent', B2: '=600*2', C4: 'x' });
    model.newSheet();
    model.newSheet();
    model.hideSheet(2);
    expect(spreadsheetTypst(model, 'budget.ic')).toContain(
      [
        '#let values = (',
        '  "Sheet1": (',
        '    ("Item", "Cost", ""),',
        '    ("Rent", "1200", ""),',
        '    ("", "", ""),',
        '    ("", "", "x"),',
        '  ),',
        '  "Sheet2": (),',
        ')',
      ].join('\n'),
    );
  });

  it('makes each sheet a table with its column widths (pixels as points: 3/4)', () => {
    const model = workbook({ A1: 'Item', B1: 'Cost' });
    model.setColumnsWidth(0, 2, 2, 200);
    const source = spreadsheetTypst(model, 'budget.ic');
    expect(source).toContain('#let sheets = (\n  "Sheet1": table(\n    columns: (67.5pt, 150pt),');
    expect(source).toContain('    align: left + bottom,\n    "Item",\n    "Cost",\n  ),');
  });

  it('gives rows that are not of the default height their height', () => {
    const model = workbook({ A1: 'a', A2: 'b', A3: 'c' });
    model.setRowsHeight(0, 2, 2, 50);
    expect(spreadsheetTypst(model, 'budget.ic')).toContain('rows: (auto, 37.5pt, auto),');
  });

  it('leaves hidden columns and rows out of the table (the values keep them)', () => {
    const model = workbook({ A1: 'a', B1: 'hidden', C1: 'c', A2: 'hidden row' });
    model.setColumnsHidden(0, 2, 2, true);
    model.setRowsHidden(0, 2, 2, true);
    const source = spreadsheetTypst(model, 'budget.ic');
    expect(source).toContain('columns: (67.5pt, 67.5pt),');
    expect(source).toContain('    "a",\n    "c",\n  ),');
    expect(source).toContain('("hidden row", "", "")');
  });

  it('aligns like the spreadsheet: numbers right, truth values and errors centered, or as formatted', () => {
    const model = workbook({ A1: 'text', B1: '12', C1: 'TRUE', D1: '=1/0', E1: 'mid' });
    style(model, 'E1', 'alignment.horizontal', 'center');
    style(model, 'E1', 'alignment.vertical', 'top');
    style(model, 'B1', 'alignment.horizontal', 'left');
    const source = spreadsheetTypst(model, 'budget.ic');
    expect(source).toContain('    "text",\n    "12",\n');
    expect(source).toContain('    table.cell(align: center + bottom, "TRUE"),\n    table.cell(align: center + bottom, "#DIV/0!"),\n');
    expect(source).toContain('    table.cell(align: center + top, "mid"),\n');
    const right = spreadsheetTypst(workbook({ A1: '12' }), 'budget.ic');
    expect(right).toContain('    table.cell(align: right + bottom, "12"),\n');
  });

  it('carries over fills, fonts and borders', () => {
    const model = workbook({ A1: 'Total', B1: 'note' });
    style(model, 'A1', 'fill.color', '#FFFF00');
    style(model, 'A1', 'font.b', 'true');
    style(model, 'A1', 'font.i', 'true');
    style(model, 'A1', 'font.color', '#FF0000');
    style(model, 'A1', 'font.size', '18');
    style(model, 'B1', 'font.u', 'true');
    style(model, 'B1', 'font.strike', 'true');
    model.setAreaWithBorder(
      { sheet: 0, row: 1, column: 1, width: 1, height: 1 },
      { item: { style: 'medium' as never, color: '#0000FF' }, type: 'Bottom' as never },
    );
    const source = spreadsheetTypst(model, 'budget.ic');
    expect(source).toContain(
      'table.cell(fill: rgb("#ffff00"), stroke: (bottom: 1.5pt + rgb("#0000ff")), text(weight: "bold", style: "italic", fill: rgb("#ff0000"), size: 1.5em, "Total")),',
    );
    expect(source).toContain('    underline(strike("note")),\n');
  });

  it('escapes text for Typst strings', () => {
    const source = spreadsheetTypst(workbook({ A1: 'say "hi" \\ #x $y$ [z]' }), 'budget.ic');
    expect(source).toContain('"say \\"hi\\" \\\\ #x $y$ [z]"');
  });

  describe('defined names', () => {
    /** The budget: items and costs in A1:B4, their sum in B5 (bold). */
    function budget(): Model {
      const model = workbook({ A1: 'Item', B1: 'Cost', A2: 'Train', B2: '120', A3: 'Hotel', B3: '180', A4: 'Museum', B4: '35', B5: '=SUM(B2:B4)' });
      style(model, 'B5', 'font.b', 'true');
      return model;
    }

    it('gives a named cell its displayed value, in `names` and `name-values`', () => {
      const model = budget();
      model.newDefinedName('Total', undefined, 'Sheet1!$B$5');
      const source = spreadsheetTypst(model, 'budget.ic');
      expect(source).toContain('#let names = (\n  "Total": "335",\n)');
      expect(source).toContain('#let name-values = (\n  "Total": "335",\n)');
    });

    it('makes a named range a table of just its cells, styled like the sheet, and its rows of values', () => {
      const model = budget();
      model.setColumnsWidth(0, 2, 2, 120);
      model.newDefinedName('Costs', undefined, 'Sheet1!$B$4:$B$5');
      const source = spreadsheetTypst(model, 'budget.ic');
      expect(source).toContain(
        [
          '#let names = (',
          '  "Costs": table(',
          '    columns: (90pt,),',
          '    align: left + bottom,',
          '    table.cell(align: right + bottom, "35"),',
          '    table.cell(align: right + bottom, text(weight: "bold", "335")),',
          '  ),',
          ')',
        ].join('\n'),
      );
      expect(source).toContain('#let name-values = (\n  "Costs": (\n    ("35",),\n    ("335",),\n  ),\n)');
    });

    it('ends ranges and whole columns or rows at the last cell with data', () => {
      const model = budget();
      model.newDefinedName('Items', undefined, 'Sheet1!$A:$A');
      model.newDefinedName('Header', undefined, 'Sheet1!$1:$1');
      model.newDefinedName('Wide', undefined, 'Sheet1!$A$4:$Z$100');
      const source = spreadsheetTypst(model, 'budget.ic');
      expect(source).toContain('  "Items": (\n    ("Item",),\n    ("Train",),\n    ("Hotel",),\n    ("Museum",),\n    ("",),\n  ),');
      expect(source).toContain('  "Header": (\n    ("Item", "Cost"),\n  ),');
      expect(source).toContain('  "Wide": (\n    ("Museum", "35"),\n    ("", "335"),\n  ),');
    });

    it('keys a name of one sheet `Sheet!name` (after the workbook-wide ones), on any sheet', () => {
      const model = budget();
      model.newSheet();
      model.renameSheet(1, "Q1 '26");
      model.setUserInput(1, 2, 2, 'q1');
      model.newDefinedName('Total', 1, 'Sheet1!$B$5');
      model.newDefinedName('Note', undefined, "'Q1 ''26'!$B$2");
      const source = spreadsheetTypst(model, 'budget.ic');
      expect(source).toContain('#let names = (\n  "Note": "q1",\n  "Q1 \'26!Total": "335",\n)');
    });

    it('leaves out names that are no reference (a constant, an expression, #REF!)', () => {
      const model = budget();
      model.newDefinedName('Total', undefined, 'Sheet1!$B$5');
      const names = [
        ...model.getDefinedNameList(),
        { name: 'Rate', formula: '0.19' },
        { name: 'Twice', formula: 'Sheet1!$B$5*2' },
        { name: 'Gone', formula: '#REF!' },
        { name: 'Elsewhere', formula: 'Sheet9!$A$1' },
      ];
      const source = spreadsheetTypst(Object.assign(Object.create(model) as Model, { getDefinedNameList: () => names }), 'budget.ic');
      expect(source).toContain('#let names = (\n  "Total": "335",\n)');
    });

    it('writes empty dictionaries when there are none', () => {
      const source = spreadsheetTypst(budget(), 'budget.ic');
      expect(source).toContain('#let names = (:)\n\n#let name-values = (:)\n');
    });
  });

  it('writes Typst that compiles: tables, fills, values and names', async () => {
    const wasm = readFileSync(new URL('../../../core/typst-engine/wasm/typst_engine_bg.wasm', import.meta.url));
    const fontDir = new URL('../../../core/typst-engine/fonts/', import.meta.url);
    const engine = await createEngine(wasm);
    for (const name of ['LibertinusSerif-Regular.otf', 'LibertinusSerif-Bold.otf']) {
      engine.addFont(readFileSync(new URL(name, fontDir)));
    }
    const model = workbook({ A1: 'Rent', B1: '=600*2', A2: 'say "hi" \\', B2: 'TRUE' });
    model.newSheet();
    model.renameSheet(1, 'My "Sheet"');
    style(model, 'A1', 'fill.color', '#FFFF00');
    style(model, 'A1', 'font.b', 'true');
    style(model, 'A2', 'font.u', 'true');
    model.setRowsHeight(0, 2, 2, 50);
    model.setAreaWithBorder(
      { sheet: 0, row: 1, column: 1, width: 2, height: 2 },
      { item: { style: 'dotted' as never, color: '#0000FF' }, type: 'Outer' as never },
    );
    model.newDefinedName('Rent', undefined, 'Sheet1!$B$1');
    model.newDefinedName('Costs', undefined, 'Sheet1!$A$1:$B$2');
    model.newDefinedName('Note', 1, 'Sheet1!$A$2');
    model.newDefinedName('_x.y', undefined, 'Sheet1!$A:$A');
    engine.setSource('/budget.ic.gen.typ', spreadsheetTypst(model, 'budget.ic'));
    engine.setSource(
      '/main.typ',
      [
        '#import "budget.ic.gen.typ": sheets, values, names, name-values',
        '#sheets.Sheet1',
        '#sheets.at("My \\"Sheet\\"")',
        'Rent: #values.Sheet1.at(0).at(1) = #names.Rent',
        '#figure(names.Costs, caption: [Costs])',
        '#name-values.Costs.at(1).at(0) #names.at("My \\"Sheet\\"!Note") #names.at("_x.y")',
        '',
      ].join('\n'),
    );
    const { pages, diagnostics } = engine.compile('/main.typ');
    expect(diagnostics).toEqual([]);
    expect(pages[0].svg).toMatch(/#ffff00/i);
  });
});

describe('typstPath', () => {
  it('puts the Typst file next to the spreadsheet', () => {
    expect(typstPath('/data/budget.ic')).toBe('/data/budget.ic.gen.typ');
  });
});

describe('spreadsheetPath', () => {
  it('is the spreadsheet of a generated Typst file, and null for any other file', () => {
    expect(spreadsheetPath('/data/budget.ic.gen.typ')).toBe('/data/budget.ic');
    expect(spreadsheetPath(typstPath('/a.b.ic'))).toBe('/a.b.ic');
    expect(spreadsheetPath('/data/budget.gen.typ')).toBeNull();
    expect(spreadsheetPath('/data/budget.ic')).toBeNull();
    expect(spreadsheetPath('/main.typ')).toBeNull();
  });
});
