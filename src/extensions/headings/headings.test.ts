// Tests for headings.ts: the command headings.toggleNumbering on the active editor's document.
import { describe, expect, it } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { TypstDocument } from '../../core/typst-document/typst-document';
import { VisualEditorHost } from '../../hosts/visual-editor/visual-editor';
import type { ExtensionContext } from '../../hosts/workbench/workbench';
import { headings, TOGGLE_NUMBERING } from './headings';

/** `headings` activated with a window whose active editor shows `document` (null: none); runs a registered command. */
function activate(document: TypstDocument | null): (id: string) => void {
  const registered = new Map<string, () => void>();
  const workbench = { registerStyleSheet: () => new Disposable(() => {}), registerMenuItem: () => new Disposable(() => {}) };
  const commands = {
    registerCommand: (id: string, handler: () => void) => (registered.set(id, handler), new Disposable(() => registered.delete(id))),
  };
  const window = { activeTextEditor: document && { document }, registerSearchProvider: () => new Disposable(() => {}) };
  headings().activate({ workbench, commands, window, visualEditor: new VisualEditorHost(), subscriptions: [] } as unknown as ExtensionContext);
  return (id) => registered.get(id)!();
}

describe('headings.toggleNumbering', () => {
  it("switches the active editor's heading numbering on and off", () => {
    const document = new TypstDocument('#set page(width: 10cm)\n\n= A\n');
    const run = activate(document);
    run(TOGGLE_NUMBERING);
    expect(document.text).toBe('#set page(width: 10cm)\n\n#set heading(numbering: "1.")\n\n= A\n');
    run(TOGGLE_NUMBERING);
    expect(document.text).toBe('#set page(width: 10cm)\n\n= A\n');
  });

  it('does nothing without an active editor', () => {
    expect(() => activate(null)(TOGGLE_NUMBERING)).not.toThrow();
  });
});
