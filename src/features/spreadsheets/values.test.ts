// Tests for values.ts.
import { describe, expect, it } from 'vitest';
import { sheetValues, valuesPath, type ValueSource } from './values';

/** A fake model: sheets of cells by "row:column" (1-based), as displayed. */
function model(sheets: { name: string; state?: string; cells: Record<string, string> }[]): ValueSource {
  return {
    getWorksheetsProperties: () => sheets.map(({ name, state = 'visible' }) => ({ name, state })),
    getColumnsWithData: (sheet, row) =>
      Object.keys(sheets[sheet].cells)
        .map((key) => key.split(':').map(Number))
        .filter(([r]) => r === row)
        .map(([, c]) => c)
        .sort((a, b) => a - b),
    getFormattedCellValue: (sheet, row, column) => sheets[sheet].cells[`${row}:${column}`] ?? '',
  };
}

describe('sheetValues', () => {
  it('gives each visible sheet its rows of displayed values, from A1 to the last cell with data', () => {
    const values = sheetValues(
      model([
        { name: 'Budget', cells: { '1:1': 'Item', '1:2': 'Cost', '2:1': 'Rent', '2:2': '1,200.00', '4:3': '=total' } },
        { name: 'Hidden', state: 'hidden', cells: { '1:1': 'x' } },
        { name: 'Empty', cells: {} },
      ]),
    );
    expect(values).toEqual({
      Budget: [
        ['Item', 'Cost', ''],
        ['Rent', '1,200.00', ''],
        ['', '', ''],
        ['', '', '=total'],
      ],
      Empty: [],
    });
  });
});

describe('valuesPath', () => {
  it('puts the values next to the spreadsheet', () => {
    expect(valuesPath('/data/budget.ic')).toBe('/data/budget.ic.json');
  });
});
