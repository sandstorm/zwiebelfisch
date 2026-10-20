// @vitest-environment jsdom
// Tests for undo-redo.ts.
import type { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { SourceRange, TypstDocument } from '../../core/typst-document/typst-document';
import { VisualEditor, VisualEditorHost } from '../../hosts/visual-editor/visual-editor';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import { testHosts } from '../../testing/testing';
import { undoRedo } from './undo-redo';

/** A Visual editor host with undo and redo. */
function withUndoRedo(): VisualEditorHost {
  const { visualEditor, commands, window } = testHosts();
  undoRedo().activate({ visualEditor, commands, window, subscriptions: [] } as unknown as ExtensionContext);
  return visualEditor;
}

function setup(text: string, host = withUndoRedo()) {
  const parent = document.body.appendChild(document.createElement('div'));
  const doc = new TypstDocument(text);
  const view = new VisualEditor(parent, doc, host);
  const tiptap = parent.querySelector<HTMLElement & { editor: Editor }>('.ProseMirror')!.editor;
  const button = (label: string) => parent.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  return { doc, view, tiptap, button };
}

describe('undo-redo', () => {
  it('undo and redo revert and reapply the last edit, each disabled while there is nothing to do', () => {
    const { doc, view, tiptap, button } = setup('Hello world\n');
    expect(button('Undo')!.disabled).toBe(true);
    expect(button('Redo')!.disabled).toBe(true);
    view.reveal(SourceRange.of({ from: 'Hello world'.length, to: 'Hello world'.length }));
    tiptap.commands.insertContent('!');
    expect(doc.text).toBe('Hello world!\n');
    button('Undo')!.click();
    expect(doc.text).toBe('Hello world\n');
    expect(button('Redo')!.disabled).toBe(false);
    button('Redo')!.click();
    expect(doc.text).toBe('Hello world!\n');
  });

  it('without it the toolbar has no such buttons; the history still works', () => {
    const { doc, view, tiptap, button } = setup('Hello\n', new VisualEditorHost());
    expect(button('Undo')).toBeNull();
    view.reveal(SourceRange.of({ from: 5, to: 5 }));
    tiptap.commands.insertContent('!');
    tiptap.commands.undo();
    expect(doc.text).toBe('Hello\n');
  });
});
