// What the comments extension contributes to the frame: the command that adds a note, its key binding and the
// Source view's "Comment" (a tab bar menu entry). Entry of extensions/comments/workbench/. See ARCHITECTURE.md,
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

const COMMENT_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>';

/**
 * "Comment" in the frame: the command `comments.addComment` adds a note in the active editor, Ctrl/Cmd+Alt+M runs
 * it, and the tab bar (menu `editor/title`) offers it in the Source tab (the Visual view has "Comment" in its own
 * toolbar). A note added in the Visual tab opens its card; in the Source tab the caret goes into the new note.
 */
export function registerAddComment(workbench: Workbench, cards: NoteCards): Disposable {
  const action = new CommentAction(activeNoteTarget(workbench, cards));
  return Disposable.from(
    workbench.registerCommand(ADD_COMMENT, () => action.comment()),
    workbench.registerKeybinding('Mod+Alt+KeyM', ADD_COMMENT),
    workbench.registerMenuItem('editor/title', {
      command: ADD_COMMENT,
      title: 'Comment',
      icon: COMMENT_ICON,
      group: 'navigation',
      when: (context) => context.editorMode === 'source',
    }),
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
