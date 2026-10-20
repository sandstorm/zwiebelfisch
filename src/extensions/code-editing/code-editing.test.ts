// @vitest-environment jsdom
// Tests for code-editing.ts, in Source editors of a host it is activated with.
import { undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../../core/typst-document/typst-document';
import { SourceEditorHost } from '../../hosts/source-editor/source-editor';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import { codeEditing } from './code-editing';

function setup(text: string) {
  const sourceEditor = new SourceEditorHost();
  codeEditing().activate({ sourceEditor, subscriptions: [] } as unknown as ExtensionContext);
  const parent = document.body.appendChild(document.createElement('div'));
  const doc = new TypstDocument(text);
  sourceEditor.createEditor(parent, doc);
  const editor = EditorView.findFromDOM(parent.querySelector<HTMLElement>('.cm-editor')!)!;
  return { doc, editor };
}

/** Presses `name` (with Shift: `shift`) in `view`; returns whether something consumed it (the browser does nothing then). */
const press = (view: EditorView, name: 'Tab' | 'Escape', shift = false) =>
  // with its keyCode, which CodeMirror reads for Escape, then Tab
  !view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: name, keyCode: KEY_CODES[name], shiftKey: shift, bubbles: true, cancelable: true }));
const KEY_CODES = { Tab: 9, Escape: 27 };

describe('codeEditing', () => {
  it('Tab indents the selected lines, Shift+Tab outdents them; Escape, then Tab goes to the browser', () => {
    const { doc, editor } = setup('a\nb\nc\n');
    editor.dispatch({ selection: { anchor: 0, head: 3 } });
    expect(press(editor, 'Tab')).toBe(true);
    expect(doc.text).toBe('  a\n  b\nc\n');
    expect(press(editor, 'Tab', true)).toBe(true);
    expect(doc.text).toBe('a\nb\nc\n');
    // with a selection, CodeMirror's Escape first leaves a caret, then turns the next Tab over to the browser
    press(editor, 'Escape');
    press(editor, 'Escape');
    expect(press(editor, 'Tab')).toBe(false);
    expect(doc.text).toBe('a\nb\nc\n');
  });

  it('gives the Source editors an undo history, line numbers and wrapped lines', () => {
    const { doc, editor } = setup('one\n');
    editor.dispatch({ changes: { from: 0, to: 3, insert: 'ONE' }, userEvent: 'input.type' });
    undo(editor);
    expect(doc.text).toBe('one\n');
    expect(editor.dom.querySelector('.cm-lineNumbers')).not.toBeNull();
    expect(editor.lineWrapping).toBe(true);
  });

  it('without it, a Source editor is bare: no history, no line numbers', () => {
    const parent = document.body.appendChild(document.createElement('div'));
    const doc = new TypstDocument('one\n');
    new SourceEditorHost().createEditor(parent, doc);
    const editor = EditorView.findFromDOM(parent.querySelector<HTMLElement>('.cm-editor')!)!;
    editor.dispatch({ changes: { from: 0, to: 3, insert: 'ONE' }, userEvent: 'input.type' });
    expect(undo(editor)).toBe(false);
    expect(doc.text).toBe('ONE\n');
    expect(editor.dom.querySelector('.cm-lineNumbers')).toBeNull();
  });
});
