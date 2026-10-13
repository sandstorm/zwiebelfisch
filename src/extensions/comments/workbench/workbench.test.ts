// @vitest-environment jsdom
// Tests for workbench.ts: the command comments.addComment.
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../../core/disposable/disposable';
import { SourceRange, type TextChange, TypstDocument } from '../../../core/typst-document/typst-document';
import { SOURCE_EDITOR } from '../../../hosts/source-editor/source-editor';
import type { TextEditor } from '../../../hosts/window/window';
import { VISUAL_EDITOR, VisualEditor, VisualEditorHost } from '../../../hosts/visual-editor/visual-editor';
import { localDate } from '../model/note-thread';
import { marginNotes } from '../visual-editor/margin-notes';
import { noteCards } from '../visual-editor/note-cards/note-cards';
import { ADD_COMMENT, registerAddComment, type CommentContext, type NoteCards } from './workbench';

const IMPORT = '#import "@preview/drafting:0.2.2": margin-note\n';

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
    },
    workbench: { registerMenuItem: () => new Disposable(() => {}) },
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
    const notes = noteCards({ user: { name: 'Anna' } });
    const contributions = VisualEditorHost.from([marginNotes({ comment: () => comment() }), notes]);
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
    const view = new VisualEditor(root, doc, VisualEditorHost.from([marginNotes({ comment: () => {} })]));
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
    const view = new VisualEditor(root, doc, VisualEditorHost.from([marginNotes({ comment: () => {} })]));
    const tiptap = (root.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
    view.reveal(SourceRange.of({ from: 2, to: 7 }));
    const editor: TextEditor = { document: doc, viewType: VISUAL_EDITOR, selection: view.selection(), revealRange: vi.fn(), insertSnippet: vi.fn(), edit: edits((changes) => view.edit(changes)) };
    setup(editor).comment();
    expect(doc.text).toBe(`${IMPORT}#margin-note[= Title][]\n\n\nHello world.\n`);
    tiptap.commands.undo();
    expect(doc.text).toBe(text);
  });
});
