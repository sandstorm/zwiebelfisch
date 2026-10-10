// The comments extension: comments are drafting margin notes in the source. The "Comment" button / Ctrl+Alt+M
// (CommentAction) and the note syntax the Visual view reads. Entry of features/comments/.
// See ARCHITECTURE.md, "Comments = margin notes".
import { Disposable } from '../../core/disposable/disposable';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import { marginNotes, notesGutter } from '../../hosts/visual-view/visual-view';
import type { TextEditor, TypstExtension, Workbench } from '../../hosts/workbench/workbench';
import { addMarginNote } from './add-margin-note';

export { addMarginNote, NOTE_STYLE } from './add-margin-note';
export { NOTE_HEAD, noteCallSyntax, printNoteCall, rangeNoteSyntax, safeNote } from './margin-note-syntax';
export { withoutNotes, type PdfEntry } from './without-notes';
export { addReply, deleteMessage, editMessage, localDate, readThread, type NewMessage, type NoteMessage } from './note-thread';

declare module '../../hosts/workbench/workbench' {
  interface CommandRegistry {
    /** Adds a margin note at the selection of the view the user works in (the comments extension). */
    'comments.addComment': () => void;
  }
}

/**
 * Comments as margin notes, written as `user` (signs replies; only own messages can be edited): in the Visual view
 * the notes in the text and a card per note in the notes gutter; "Comment" in the Visual view's toolbar and, for the
 * Source view, in the tab bar; Ctrl/Cmd+Alt+M in both. A note added in the Visual view opens its card.
 */
export function comments(options: { user?: { name: string } } = {}): TypstExtension {
  return {
    id: 'comments',
    activate(context) {
      const { workbench, subscriptions } = context;
      const notes = notesGutter({ user: options.user });
      const action = new CommentAction(workbench.ownerDocument, () => noteTarget(workbench, notes));
      subscriptions.push(
        new Disposable(() => action.destroy()),
        workbench.registerCommand('comments.addComment', () => action.comment()),
        workbench.registerKeybinding('Mod+Alt+KeyM', 'comments.addComment'),
        // the Visual view has "Comment" in its own toolbar
        workbench.registerTabBarItem(action.button, { mode: 'source' }),
      );
      marginNotes({ comment: () => action.comment() }).activate(context);
      notes.activate(context);
    },
  };
}

/** Where "Comment" adds a note: the active editor; in its Visual tab, the new note's card opens. */
function noteTarget(workbench: Workbench, notes: { editNote(document: TypstDocument, offset: number): boolean }): ReturnType<NoteTarget> {
  const editor: TextEditor | null = workbench.activeTextEditor;
  if (!editor) return null;
  const { document } = editor;
  return {
    document,
    view: {
      selection: () => editor.selection,
      reveal: (from, to) => editor.revealRange(from, to),
      editNote: editor.mode === 'visual' ? (offset) => notes.editNote(document, offset) : undefined,
    },
  };
}

/** An editing view a note can be added in (source offsets throughout). */
export interface NoteView {
  selection(): { from: number; to: number };
  reveal(from: number, to: number): void;
  /** Opens the editor of the note whose source holds `offset`, if the view has one; false if not. */
  editNote?(offset: number): boolean;
}

/** Where the user works right now; null while no Typst file is shown. */
export type NoteTarget = () => { document: TypstDocument; view: NoteView } | null;

/**
 * The "Comment" button: adds a `drafting` margin note at the selection of the
 * active view, in the document's own Typst (`#margin-note[selection][]`, or
 * `#margin-note[]` at a cursor, plus the import), and puts the cursor into the
 * new note. The comments extension binds `comment` to Ctrl/Cmd+Alt+M as well.
 */
export class CommentAction {
  /** The button, for the host's toolbar. */
  readonly button: HTMLButtonElement;

  constructor(doc: Document, private readonly target: NoteTarget) {
    this.button = commentButton(doc);
    this.button.addEventListener('mousedown', (event) => event.preventDefault()); // keep the editor's selection
    this.button.addEventListener('click', () => this.comment());
  }

  /** Adds a note at the active view's selection and focuses it; does nothing where no note fits. */
  comment(): void {
    const target = this.target();
    if (!target) return;
    const { document, view } = target;
    const added = addMarginNote(document.text, view.selection());
    if (!added) return;
    document.change(added.changes, this);
    if (!view.editNote?.(added.note)) view.reveal(added.note, added.note);
  }

  destroy(): void {
    this.button.remove();
  }
}

function commentButton(doc: Document): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'typst-editor__comment';
  button.title = 'Add a margin note to the selection (Ctrl+Alt+M)';
  button.innerHTML =
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg><span>Comment</span>';
  return button;
}
