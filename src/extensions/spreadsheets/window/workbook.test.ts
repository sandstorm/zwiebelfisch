// Tests for workbook.ts: the realm's IronCalc engine (IronCalc itself faked: it needs a browser).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ironCalc = vi.hoisted(() => ({ init: vi.fn<() => Promise<void>>() }));

vi.mock('@ironcalc/workbook', () => ({
  init: ironCalc.init,
  IronCalc: () => null,
  Model: class {
    toBytes = () => new Uint8Array([1]);
    getWorksheetsProperties = () => [{ name: 'Sheet1' }];
    free() {}
  },
}));
vi.mock('@ironcalc/workbook/style.css?inline', () => ({ default: '.ic {}' }));
vi.mock('../model/sheet-figure', () => ({ typeStarterTable: () => {} }));
vi.mock('../model/typst-file', () => ({ spreadsheetTypst: () => '#let sheets = (Sheet1: [])\n' }));

beforeEach(() => {
  vi.resetModules();
  ironCalc.init.mockReset();
});

describe('newWorkbook', () => {
  it('initializes the engine once for all workbooks', async () => {
    ironCalc.init.mockResolvedValue(undefined);
    const { newWorkbook } = await import('./workbook');
    await newWorkbook('a.ic');
    await newWorkbook('b.ic');
    expect(ironCalc.init).toHaveBeenCalledTimes(1);
  });

  it('retries a failed initialization on the next use', async () => {
    ironCalc.init.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { newWorkbook } = await import('./workbook');
    await expect(newWorkbook('a.ic')).rejects.toThrow('offline');
    await expect(newWorkbook('a.ic')).resolves.toMatchObject({ sheet: 'Sheet1' });
    expect(ironCalc.init).toHaveBeenCalledTimes(2);
  });
});
