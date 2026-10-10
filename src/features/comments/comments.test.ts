// @vitest-environment jsdom
// Tests for comments.ts.
import { describe, expect, it, vi } from 'vitest';
import { TypstDocument } from '../../core/typst-document/typst-document';
import { marginNotes, markup, notesGutter, VisualView, VisualViewContributions } from '../../hosts/visual-view/visual-view';
import { CommentAction, localDate, NOTE_STYLE, type NoteView } from './comments';

const IMPORT = `#import "@preview/drafting:0.2.2": margin-note, set-margin-note-defaults\n${NOTE_STYLE}`;

function setup(text: string, view: NoteView | ((document: TypstDocument, parent: HTMLElement) => NoteView)) {
  const root = document.createElement('div');
  document.body.append(root);
  const doc = new TypstDocument(text);
  const shown = typeof view === 'function' ? view(doc, root) : view;
  const action = new CommentAction(document, () => ({ document: doc, view: shown }));
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

  it('opens the new note\'s card in the Visual view: the first message is signed with name and date', () => {
    let comment = () => {};
    const { doc, root, action } = setup('Hello world\n', (document, parent) => {
      const notes = notesGutter({ user: { name: 'Anna' } });
      const contributions = VisualViewContributions.from([markup, marginNotes({ comment: () => comment() }), notes]);
      const view = new VisualView(parent.appendChild(window.document.createElement('div')), document, contributions);
      view.reveal(6, 11);
      // as the widget makes it: the Visual view's notes gutter opens the new note's card
      return { selection: () => view.selection(), reveal: (from, to) => view.reveal(from, to), editNote: (offset) => notes.editNote(document, offset) };
    });
    comment = () => action.comment();
    // the Visual view's toolbar button
    root.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Comment"]')!.click();
    expect(doc.text).toBe(`${IMPORT}Hello #margin-note[world][]\n`);
    const field = root.querySelector<HTMLTextAreaElement>('[data-testid="typst-note-card"] .typst-note-card__reply')!;
    expect(document.activeElement).toBe(field);
    field.value = 'Check this';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(doc.text).toBe(`${IMPORT}Hello #margin-note[world][- *Anna* (${localDate()}): Check this]\n`);
  });

  it('does nothing where no note fits', () => {
    const text = '#set text(size: 12pt)\n';
    const { doc, action } = setup(text, { selection: () => ({ from: 16, to: 20 }), reveal: () => {} });
    action.comment();
    expect(doc.text).toBe(text);
  });
});
