// The comments extension. Why: comments are drafting margin notes in the Typst source itself, not a store beside
// it, so the preview, git, undo and collaboration carry them as ordinary text. The extension shows them in the
// Visual view (notes in the text, a card per note in the notes gutter), adds them ("Comment", Ctrl/Cmd+Alt+M) and
// lets a PDF leave them out (the export option `comments.include`). Entry of extensions/comments/. See
// docs/guide/features.typ.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './comments.css?inline';
import { registerIncludeComments } from './preview/preview';
import { marginNotes } from './visual-view/margin-notes';
import { notesGutter } from './visual-view/notes-gutter/notes-gutter';
import { commentSearch } from './workbench/comment-search';
import { ADD_COMMENT, registerAddComment } from './workbench/workbench';

/**
 * Comments as margin notes, written as the workbench's `user` (signs replies; only own messages can be edited): in
 * the Visual view the notes in the text and a card per note in the notes gutter; "Comment" in the Visual view's
 * toolbar and, for the Source view, in the tab bar; Ctrl/Cmd+Alt+M in both (the command `comments.addComment`). A note
 * added in the Visual view opens its card. PDF exports get the option `comments.include` (default off: the notes are
 * left out). Search everywhere finds the notes by text and author.
 */
export function comments(): TypstExtension {
  return {
    id: 'comments',
    contributes: { commands: [{ command: ADD_COMMENT, title: 'Add comment', category: 'Comments' }] },
    activate(context) {
      context.subscriptions.push(context.workbench.registerStyleSheet(css));
      const { project, commands, window, workbench, preview, subscriptions } = context;
      const notes = notesGutter({ user: workbench.user });
      subscriptions.push(
        registerAddComment(context, notes),
        registerIncludeComments(preview, project),
        window.registerSearchProvider(commentSearch(context, notes)),
      );
      marginNotes({ comment: () => commands.executeCommand(ADD_COMMENT).catch((error: unknown) => console.error(error)) }).activate(context);
      notes.activate(context);
    },
  };
}
