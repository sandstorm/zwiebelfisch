// What the comments extension contributes to the frame: the command that adds a note, its key binding and the
// Source view's "Comment" button. Entry of extensions/comments/workbench/. See ARCHITECTURE.md,
// "Comments = margin notes".
import { Disposable } from '../../../core/disposable/disposable';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import type { Workbench } from '../../../hosts/workbench/workbench';
import { CommentAction, type NoteTarget } from './comment-action';

export { CommentAction, type NoteTarget, type NoteView } from './comment-action';

/** The command that adds a margin note at the selection of the view the user works in. */
export const ADD_COMMENT = 'comments.addComment';

/** The notes' cards in the Visual views: the notes gutter. */
export interface NoteCards {
  /** Focuses the card of the note whose source holds `offset` in `document`'s Visual view; false if there is none. */
  editNote(document: TypstDocument, offset: number): boolean;
}

/**
 * "Comment" in the frame: the command `comments.addComment` adds a note in the active editor, Ctrl/Cmd+Alt+M runs
 * it, and the tab bar has its button for the Source view (the Visual view has "Comment" in its own toolbar). A note
 * added in the Visual tab opens its card; in the Source tab the caret goes into the new note.
 */
export function registerAddComment(workbench: Workbench, cards: NoteCards): Disposable {
  const action = new CommentAction(workbench.ownerDocument, activeNoteTarget(workbench, cards));
  return Disposable.from(
    new Disposable(() => action.destroy()),
    workbench.registerCommand(ADD_COMMENT, () => action.comment()),
    workbench.registerKeybinding('Mod+Alt+KeyM', ADD_COMMENT),
    workbench.registerTabBarItem(action.button, { mode: 'source' }),
  );
}

/** Where "Comment" adds a note: the active editor; in its Visual tab, the new note's card opens. */
function activeNoteTarget(workbench: Workbench, cards: NoteCards): NoteTarget {
  return () => {
    const editor = workbench.activeTextEditor;
    if (!editor) return null;
    const { document } = editor;
    return {
      document,
      view: {
        selection: () => editor.selection,
        reveal: (from, to) => editor.revealRange(from, to),
        editNote: editor.mode === 'visual' ? (offset) => cards.editNote(document, offset) : undefined,
      },
    };
  };
}
