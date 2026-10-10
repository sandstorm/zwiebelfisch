// CommentAction: "Comment" adds a margin note at the selection of the view the user works in. See workbench.ts.
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import { addMarginNote } from '../model/model';

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
 * "Comment": adds a `drafting` margin note at the selection of the
 * active view, in the document's own Typst (`#margin-note[selection][]`, or
 * `#margin-note[]` at a cursor, plus the import), and puts the cursor into the
 * new note. The comments extension runs `comment` as its command (the tab bar's "Comment", Ctrl/Cmd+Alt+M).
 */
export class CommentAction {
  constructor(private readonly target: NoteTarget) {}

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
}
