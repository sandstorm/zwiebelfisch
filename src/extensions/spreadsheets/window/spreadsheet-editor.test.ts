// @vitest-environment jsdom
// Tests for spreadsheet-editor.ts: IronCalc's style sheet held while an editor lives (the workbook itself faked).
import { describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../../core/disposable/disposable';
import { ProjectPath } from '../../../core/paths/paths';
import { SpreadsheetEditor } from './spreadsheet-editor';

vi.mock('./workbook', () => ({
  WORKBOOK_STYLE_SHEET: '.ic {}',
  mountWorkbook: async () => ({ dispose() {} }),
}));

/** An editor whose style-sheet registrations are counted in `held`. */
function editor(held: { count: number }) {
  const register = (css: string) => {
    expect(css).toBe('.ic {}');
    held.count++;
    return new Disposable(() => held.count--);
  };
  return new SpreadsheetEditor(document.body.appendChild(document.createElement('div')), () => {}, register);
}

describe('SpreadsheetEditor', () => {
  it("registers IronCalc's style sheet once while shown, and releases it when disposed", async () => {
    const held = { count: 0 };
    const shown = editor(held);
    await shown.show(ProjectPath.of('/a.ic'), new Uint8Array());
    await shown.show(ProjectPath.of('/b.ic'), new Uint8Array());
    expect(held.count).toBe(1);
    shown.dispose();
    expect(held.count).toBe(0);
  });

  it('holds a registration per editor', async () => {
    const held = { count: 0 };
    const one = editor(held);
    const two = editor(held);
    await one.show(ProjectPath.of('/a.ic'), new Uint8Array());
    await two.show(ProjectPath.of('/b.ic'), new Uint8Array());
    expect(held.count).toBe(2);
    one.dispose();
    expect(held.count).toBe(1);
    two.dispose();
    expect(held.count).toBe(0);
  });
});
