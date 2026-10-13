import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './comments.css?inline';
import { registerIncludeComments, registerShowComments } from './preview/preview';
import { marginNotes } from './visual-editor/margin-notes';
import { noteCards } from './visual-editor/note-cards/note-cards';
import { commentSearch } from './workbench/comment-search';
import { ADD_COMMENT, registerAddComment } from './workbench/workbench';

/**
 * Comments as `drafting` margin notes in the Typst source itself, not in a store beside it. So the preview, git, undo
 * and collaboration carry them as ordinary text, and a margin note written by hand is a comment too.
 *
 * In the Visual editor a note shows in the text as a speech-bubble marker, a range note's text highlighted
 * (visual-editor/margin-notes.ts); its thread of replies opens in a card floating at the marker (NoteCardPopover), not
 * in a column beside the text. Replies are signed as the workbench's `user`; only own messages can be edited.
 * "Comment" (the command `comments.addComment`, Ctrl/Cmd+Alt+M) adds a note: in the Visual editor's toolbar, and in
 * the tab bar for the Source editor. A note added in the Visual editor opens its card. Search everywhere finds the
 * notes by text and author ("Comments", prefix `!`). The preview draws the notes in the page margin (drafting's own).
 *
 * PDF exports get the option `comments.include` (default off). The PDF itself is the pdfExport extension's; this one
 * only decides what it compiles. The preview gets the view option `comments.show` ("Comments" in the View menu,
 * default on), which hides the notes in the preview only. The notes' look is the extension's: the preview and the PDF
 * set it when they compile, the documents hold plain drafting (NOTE_STYLE in preview/preview.ts). `model/` knows the
 * note syntax (margin-note-syntax.ts) and the thread format (note-thread.ts). See docs/20_features/10_comments.typ.
 */
export function comments(): TypstExtension {
  return {
    id: 'comments',
    contributes: { commands: [{ command: ADD_COMMENT, title: 'Add comment', category: 'Comments' }] },
    activate(context) {
      context.subscriptions.push(context.workbench.registerStyleSheet(css));
      const { project, commands, window, workbench, preview, subscriptions } = context;
      const notes = noteCards({ user: workbench.user });
      subscriptions.push(
        registerAddComment(context, notes),
        registerIncludeComments(preview, project),
        registerShowComments(preview, project),
        window.registerSearchProvider(commentSearch(context, notes)),
      );
      marginNotes({ comment: () => commands.executeCommand(ADD_COMMENT).catch((error: unknown) => console.error(error)) }).activate(context);
      notes.activate(context);
    },
  };
}
