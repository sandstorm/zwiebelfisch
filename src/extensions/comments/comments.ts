// The comments extension. Why: comments are drafting margin notes in the Typst source itself, not a store beside
// it, so the preview, git, undo and collaboration carry them as ordinary text. The extension shows them in the
// Visual view (notes in the text, a card per note in the notes gutter), adds them ("Comment", Ctrl/Cmd+Alt+M) and
// offers the PDF without them. Entry of extensions/comments/. See ARCHITECTURE.md, "Comments = margin notes".
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './comments.css?inline';
import { CommentsPdf, registerPdfVariants } from './preview/preview';
import { marginNotes, notesGutter } from './visual-view/visual-view';
import { registerAddComment } from './workbench/workbench';

// for tests that compose Visual views with margin notes outside the widget (collaboration's convergence)
export { addMarginNote } from './model/model';
export { marginNotes } from './visual-view/visual-view';

declare module '../../hosts/workbench/workbench' {
  interface CommandRegistry {
    /** The project's PDF as it is now, with or without the comments; rejects naming the errors (the comments extension). */
    'comments.exportPdf': (withComments: boolean) => Promise<Blob>;
  }
}

/**
 * Comments as margin notes, written as `user` (signs replies; only own messages can be edited): in the Visual view
 * the notes in the text and a card per note in the notes gutter; "Comment" in the Visual view's toolbar and, for the
 * Source view, in the tab bar; Ctrl/Cmd+Alt+M in both. A note added in the Visual view opens its card. The preview
 * offers the PDF without and with comments, and `comments.exportPdf` makes either (through `pdfExport.export`).
 */
export function comments(options: { user?: { name: string } } = {}): TypstExtension {
  return {
    id: 'comments',
    activate(context) {
      context.subscriptions.push(context.workbench.registerStyleSheet(css));
      const { project, workbench, preview, subscriptions } = context;
      const notes = notesGutter({ user: options.user });
      const pdfs = new CommentsPdf(project, workbench);
      subscriptions.push(
        registerAddComment(workbench, notes),
        workbench.registerCommand('comments.exportPdf', (withComments) => pdfs.blob(withComments)),
        registerPdfVariants(preview, pdfs),
      );
      marginNotes({ comment: () => workbench.executeCommand('comments.addComment') }).activate(context);
      notes.activate(context);
    },
  };
}
