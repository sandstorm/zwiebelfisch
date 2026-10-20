import type { Extension } from '../../hosts/workbench/workbench';
import css from './comments.css?inline';
import { registerIncludeComments, registerShowComments } from './preview/preview';
import { registerCommentButtons, registerMarginNotes } from './visual-editor/margin-notes';
import { registerNoteCards } from './visual-editor/note-cards/note-cards';
import { commentSearch } from './workbench/comment-search';
import { ADD_COMMENT, registerAddComment } from './workbench/workbench';

/**
 * Comments as `drafting` margin notes in the Typst source itself, so a margin note written by hand is a comment too.
 *
 * Adds:
 * - "Comment" (`comments.addComment`, Ctrl/Cmd+Alt+M) in the Visual editor's toolbar and the Source tab's tab bar
 * - in the Visual editor, a note's thread in a card floating at its marker; replies are signed as the window's
 *   `user`, and only own messages can be edited
 * - the notes in search everywhere (prefix `!`)
 * - the PDF export option `comments.include` (default off) and the view option `comments.show` (default on, preview only)
 */
export function comments(): Extension {
  return {
    id: 'comments',
    contributes: {
      commands: [{ command: ADD_COMMENT, title: 'Add comment', category: 'Comments' }],
      keybindings: [{ command: ADD_COMMENT, key: 'Mod+Alt+KeyM' }],
    },
    activate(context) {
      context.subscriptions.push(context.window.registerStyleSheet(css));
      const { project, window, preview, visualEditor, subscriptions } = context;
      const notes = registerNoteCards(visualEditor, {
        get user() {
          return window.user;
        },
      });
      subscriptions.push(
        registerMarginNotes(visualEditor),
        registerCommentButtons(window, ADD_COMMENT),
        notes,
        registerAddComment(context, notes),
        registerIncludeComments(preview, project),
        registerShowComments(preview, project),
        window.registerSearchProvider(commentSearch(context, notes)),
      );
    },
  };
}
