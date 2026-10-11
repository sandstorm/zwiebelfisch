// @vitest-environment jsdom
// Tests for workbench.ts: the command comments.addComment.
import { describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../../core/disposable/disposable';
import { SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';
import { SOURCE_VIEW_TYPE } from '../../../hosts/source-view/source-view';
import type { TextEditor } from '../../../hosts/window/window';
import { VISUAL_VIEW_TYPE, VisualView, VisualViewHost } from '../../../hosts/visual-view/visual-view';
import { localDate } from '../model/note-thread';
import { NOTE_STYLE } from '../model/add-margin-note';
import { marginNotes } from '../visual-view/margin-notes';
import { notesGutter } from '../visual-view/notes-gutter/notes-gutter';
import { ADD_COMMENT, registerAddComment, type CommentContext, type NoteCards } from './workbench';

const IMPORT = `#import "@preview/drafting:0.2.2": margin-note, set-margin-note-defaults\n${NOTE_STYLE}`;

/** A workbench showing `editor`, with comments.addComment registered: `comment()` runs the command. */
function setup(editor: TextEditor | null, cards: NoteCards = { editNote: () => false }) {
  const commands = new Map<string, () => unknown>();
  const context: CommentContext = {
    window: { activeTextEditor: editor },
    commands: {
      registerCommand: (id, handler) => {
        commands.set(id, handler);
        return new Disposable(() => commands.delete(id));
      },
      registerKeybinding: () => new Disposable(() => {}),
    },
    workbench: { registerMenuItem: () => new Disposable(() => {}) },
  };
  registerAddComment(context, cards);
  return { comment: () => commands.get(ADD_COMMENT)!() };
}

function sourceEditor(document: TypstDocument, selection: { from: number; to: number }): TextEditor {
  return { document, viewType: SOURCE_VIEW_TYPE, selection: SourceRange.of(selection), revealRange: vi.fn() };
}

describe('comments.addComment', () => {
  it('wraps the selection in the Source view and puts the caret into the note', () => {
    const doc = new TypstDocument('Hello world\n');
    const editor = sourceEditor(doc, { from: 6, to: 11 });
    setup(editor).comment();
    expect(doc.text).toBe(`${IMPORT}Hello #margin-note[world][]\n`);
    const body = doc.text.lastIndexOf('[]') + 1;
    expect(editor.revealRange).toHaveBeenCalledWith({ from: body, to: body });
  });

  it('opens the new note\'s card in the Visual view: the first message is signed with name and date', () => {
    const root = document.body.appendChild(document.createElement('div'));
    const doc = new TypstDocument('Hello world\n');
    let comment = () => {};
    const notes = notesGutter({ user: { name: 'Anna' } });
    const contributions = VisualViewHost.from([marginNotes({ comment: () => comment() }), notes]);
    const view = new VisualView(root.appendChild(document.createElement('div')), doc, contributions);
    view.reveal(SourceRange.of({ from: 6, to: 11 }));
    const editor: TextEditor = {
      document: doc,
      viewType: VISUAL_VIEW_TYPE,
      get selection() {
        return view.selection();
      },
      revealRange: (range) => view.reveal(range),
    };
    // as the widget wires it: the notes gutter opens the new note's card
    comment = setup(editor, notes).comment;
    // the Visual view's toolbar button
    root.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Comment"]')!.click();
    expect(doc.text).toBe(`${IMPORT}Hello #margin-note[world][]\n`);
    const field = root.querySelector<HTMLTextAreaElement>('[data-testid="typst-note-card"] .typst-comments__card-reply')!;
    expect(document.activeElement).toBe(field);
    field.value = 'Check this';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(doc.text).toBe(`${IMPORT}Hello #margin-note[world][- *Anna* (${localDate()}): Check this]\n`);
  });

  it('does nothing where no note fits, or without an editor', () => {
    const text = '#set text(size: 12pt)\n';
    const doc = new TypstDocument(text);
    setup(sourceEditor(doc, { from: 16, to: 20 })).comment();
    expect(doc.text).toBe(text);
    expect(() => setup(null).comment()).not.toThrow();
  });
});
