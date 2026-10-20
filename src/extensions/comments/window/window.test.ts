// @vitest-environment jsdom
// Tests for window.ts: the command comments.addComment.
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../../core/disposable/disposable';
import { SourceRange, type TextChange, TypstDocument } from '../../../core/typst-document/typst-document';
import { SOURCE_EDITOR } from '../../../hosts/source-editor/source-editor';
import type { TextEditor } from '../../../hosts/window/window';
import { VISUAL_EDITOR, VisualEditor, VisualEditorHost } from '../../../hosts/visual-editor/visual-editor';
import { localDate } from '../model/note-thread';
import { testHosts } from '../../../testing/testing';
import { registerCommentButtons, registerMarginNotes } from '../visual-editor/margin-notes';
import { registerNoteCards } from '../visual-editor/note-cards/note-cards';
import { ADD_COMMENT, registerAddComment, type CommentContext, type NoteCards } from './window';

const IMPORT = '#import "@preview/drafting:0.2.2": margin-note\n';

/** A window showing `editor`, with comments.addComment registered: `comment()` runs the command. */
function setup(editor: TextEditor | null, cards: NoteCards = { editNote: () => false }) {
  const commands = new Map<string, () => unknown>();
  const context: CommentContext = {
    window: { activeTextEditor: editor, registerMenuItem: () => new Disposable(() => {}) },
    commands: {
      registerCommand: (id, handler) => {
        commands.set(id, handler);
        return new Disposable(() => commands.delete(id));
      },
    },
  };
  registerAddComment(context, cards);
  return { comment: () => commands.get(ADD_COMMENT)!() };
}

function sourceEditor(document: TypstDocument, selection: { from: number; to: number }): TextEditor {
  return { document, viewType: SOURCE_EDITOR, selection: SourceRange.of(selection), revealRange: vi.fn(), insertSnippet: vi.fn(), edit: edits((changes) => document.change(changes, 'test')) };
}

/** A `TextEditor.edit` that hands the edits made to `apply`. */
function edits(apply: (changes: TextChange[]) => void): TextEditor['edit'] {
  return (callback) => {
    const changes: TextChange[] = [];
    callback({
      replace: ({ from, to }, insert) => changes.push({ from, to, insert }),
      insert: (at, insert) => changes.push({ from: at, to: at, insert }),
      delete: ({ from, to }) => changes.push({ from, to, insert: '' }),
    });
    apply(changes);
  };
}

describe('comments.addComment', () => {
  it('wraps the selection in the Source editor and puts the caret into the note', () => {
    const doc = new TypstDocument('Hello world\n');
    const editor = sourceEditor(doc, { from: 6, to: 11 });
    setup(editor).comment();
    expect(doc.text).toBe(`${IMPORT}Hello #margin-note[world][]\n`);
    const body = doc.text.lastIndexOf('[]') + 1;
    expect(editor.revealRange).toHaveBeenCalledWith({ from: body, to: body });
  });

  it('opens the new note\'s card in the Visual editor: the first message is signed with name and date', () => {
    const root = document.body.appendChild(document.createElement('div'));
    const doc = new TypstDocument('Hello world\n');
    let comment = () => {};
    const { visualEditor: contributions, commands, window } = testHosts();
    registerMarginNotes(contributions);
    registerCommentButtons(window, 'test.comment');
    commands.registerCommand('test.comment', () => comment());
    const notes = registerNoteCards(contributions, { user: { name: 'Anna' } });
    const view = new VisualEditor(root.appendChild(document.createElement('div')), doc, contributions);
    view.reveal(SourceRange.of({ from: 6, to: 11 }));
    const editor: TextEditor = {
      document: doc,
      viewType: VISUAL_EDITOR,
      get selection() {
        return view.selection();
      },
      revealRange: (range) => view.reveal(range),
      insertSnippet: (snippet) => view.insert(snippet),
      edit: edits((changes) => view.edit(changes)),
    };
    // as the widget wires it: the new note's card opens
    comment = setup(editor, notes).comment;
    // the Visual editor's toolbar button
    root.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Comment"]')!.click();
    expect(doc.text).toBe(`${IMPORT}Hello #margin-note[world][]\n`);
    const field = root.querySelector<HTMLTextAreaElement>('[data-testid="zwf-note-card"] .zwf-comments__card-reply')!;
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

  it('leaves the document alone with the Visual editor\'s preamble box selected (Mod+Alt+M runs the command)', () => {
    const root = document.body.appendChild(document.createElement('div'));
    const text = `${IMPORT}#set page(width: 16cm)\n#set text(size: 12pt)\n#show link: underline\n\n= Title\n\nHello *stars* world.\n`;
    const doc = new TypstDocument(text);
    const view = new VisualEditor(root, doc, withMarginNotes());
    const tiptap = (root.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
    expect(tiptap.state.doc.firstChild?.type.name).toBe('rawBlock');
    tiptap.view.dispatch(tiptap.state.tr.setSelection(NodeSelection.create(tiptap.state.doc, 0)));
    const editor: TextEditor = { document: doc, viewType: VISUAL_EDITOR, selection: view.selection(), revealRange: vi.fn(), insertSnippet: vi.fn(), edit: edits((changes) => view.edit(changes)) };
    setup(editor).comment();
    expect(doc.text).toBe(text);
    expect(root.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Comment"]')!.disabled).toBe(true);
  });

  it('adds a note on a heading above the file\'s import and moves the import to the top, in one undo step (Visual editor)', () => {
    const root = document.body.appendChild(document.createElement('div'));
    const text = `= Title\n\n${IMPORT}\nHello world.\n`;
    const doc = new TypstDocument(text);
    const view = new VisualEditor(root, doc, withMarginNotes());
    const tiptap = (root.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
    view.reveal(SourceRange.of({ from: 2, to: 7 }));
    const editor: TextEditor = { document: doc, viewType: VISUAL_EDITOR, selection: view.selection(), revealRange: vi.fn(), insertSnippet: vi.fn(), edit: edits((changes) => view.edit(changes)) };
    setup(editor).comment();
    expect(doc.text).toBe(`${IMPORT}#margin-note[= Title][]\n\n\nHello world.\n`);
    tiptap.commands.undo();
    expect(doc.text).toBe(text);
  });
});

/** A Visual editor host with margin notes (their "Comment" does nothing). */
/** A Visual editor host with the margin notes and the Comment buttons. */
function withMarginNotes(): VisualEditorHost {
  const { visualEditor, window } = testHosts();
  registerMarginNotes(visualEditor);
  registerCommentButtons(window, ADD_COMMENT);
  return visualEditor;
}
