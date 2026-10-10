// @vitest-environment jsdom
import '../visual-view/jsdom-setup';
import { describe, expect, it, vi } from 'vitest';
import { TypstDocument } from '../document/typst-document';
import { VisualView } from '../visual-view/visual-view';
import { CommentAction, type NoteView } from './comment-action';

const IMPORT = '#import "@preview/drafting:0.2.2": margin-note\n';

function setup(text: string, view: NoteView | ((document: TypstDocument, parent: HTMLElement) => NoteView)) {
  const root = document.createElement('div');
  document.body.append(root);
  const doc = new TypstDocument(text);
  const shown = typeof view === 'function' ? view(doc, root) : view;
  const action = new CommentAction(root, () => ({ document: doc, view: shown }));
  root.append(action.button);
  return { doc, root, action, view: shown };
}

describe('CommentAction', () => {
  it('wraps the selection of a source-like view and puts the cursor into the note', () => {
    const reveal = vi.fn();
    const { doc, action } = setup('Hello world\n', { selection: () => ({ from: 6, to: 11 }), reveal });
    action.button.click();
    expect(doc.text).toBe(`${IMPORT}Hello #margin-note[world][]\n`);
    const body = doc.text.lastIndexOf('[]') + 1;
    expect(reveal).toHaveBeenCalledWith(body, body);
  });

  it('answers Ctrl/Cmd+Alt+M and keeps it from the editors', () => {
    const { doc, root } = setup('Hi\n', { selection: () => ({ from: 2, to: 2 }), reveal: () => {} });
    const inner = root.appendChild(document.createElement('div'));
    const seen = vi.fn();
    inner.addEventListener('keydown', seen);
    inner.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', altKey: true, ctrlKey: true, bubbles: true }));
    expect(doc.text).toBe(`${IMPORT}Hi#margin-note[]\n`);
    expect(seen).not.toHaveBeenCalled();
  });

  it('opens the new note in the Visual view', () => {
    const { doc, action, root } = setup('Hello world\n', (document, parent) => {
      const view = new VisualView(parent.appendChild(window.document.createElement('div')), document);
      view.reveal(6, 11);
      return view;
    });
    action.comment();
    expect(doc.text).toBe(`${IMPORT}Hello #margin-note[world][]\n`);
    const field = root.querySelector<HTMLTextAreaElement>('[data-testid="typst-margin-note"] textarea')!;
    expect(document.activeElement).toBe(field);
    field.value = 'Check this';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(doc.text).toBe(`${IMPORT}Hello #margin-note[world][Check this]\n`);
  });

  it('does nothing where no note fits', () => {
    const text = '#set text(size: 12pt)\n';
    const { doc, action } = setup(text, { selection: () => ({ from: 16, to: 20 }), reveal: () => {} });
    action.comment();
    expect(doc.text).toBe(text);
  });
});
