// The comments extension. Why: comments are drafting margin notes in the Typst source itself, not a store beside
// it, so the preview, git, undo and collaboration carry them as ordinary text. The extension shows them in the
// Visual view (notes in the text, a card per note in the notes gutter), adds them ("Comment", Ctrl/Cmd+Alt+M) and
// lets a PDF leave them out (the export option `comments.include`). Entry of extensions/comments/. See
// ARCHITECTURE.md, "Comments = margin notes".
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './comments.css?inline';
import { registerIncludeComments } from './preview/preview';
import { marginNotes, notesGutter } from './visual-view/visual-view';
import { registerAddComment } from './workbench/workbench';

// for tests that compose Visual views with margin notes outside the widget (collaboration's convergence)
export { addMarginNote } from './model/model';
export { marginNotes } from './visual-view/visual-view';

/**
 * Comments as margin notes, written as `user` (signs replies; only own messages can be edited): in the Visual view
 * the notes in the text and a card per note in the notes gutter; "Comment" in the Visual view's toolbar and, for the
 * Source view, in the tab bar; Ctrl/Cmd+Alt+M in both. A note added in the Visual view opens its card. PDF exports
 * get the option `comments.include` (default off: the notes are left out).
 */
export function comments(options: { user?: { name: string } } = {}): TypstExtension {
  return {
    id: 'comments',
    activate(context) {
      context.subscriptions.push(context.workbench.registerStyleSheet(css));
      const { project, workbench, preview, subscriptions } = context;
      const notes = notesGutter({ user: options.user });
      subscriptions.push(registerAddComment(workbench, notes), registerIncludeComments(preview, project));
      marginNotes({ comment: () => workbench.executeCommand('comments.addComment') }).activate(context);
      notes.activate(context);
    },
  };
}
