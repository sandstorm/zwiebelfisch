// Tests for headings.ts: the command headings.toggleNumbering on the active editor's document.
import { describe, expect, it } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { TypstDocument } from '../../core/typst-document/typst-document';
import { VisualViewContributions } from '../../hosts/visual-view/visual-view';
import type { ExtensionContext } from '../../hosts/workbench/workbench';
import { headings, TOGGLE_NUMBERING } from './headings';

/** `headings` activated with a workbench whose active editor shows `document` (null: none); runs a registered command. */
function activate(document: TypstDocument | null): (id: string) => void {
  const commands = new Map<string, () => void>();
  const workbench = {
    registerStyleSheet: () => new Disposable(() => {}),
    registerCommand: (id: string, handler: () => void) => (commands.set(id, handler), new Disposable(() => commands.delete(id))),
    activeTextEditor: document && { document },
  };
  headings.activate({ workbench, visualView: new VisualViewContributions(), subscriptions: [] } as unknown as ExtensionContext);
  return (id) => commands.get(id)!();
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
