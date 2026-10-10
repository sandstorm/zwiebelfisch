import type { TypstDocument } from '../document/typst-document';
import { addMarginNote } from './add-margin-note';

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
 * The "Comment" button (and Ctrl/Cmd+Alt+M inside `root`): adds a `drafting`
 * margin note at the selection of the active view, in the document's own
 * Typst (`#margin-note[selection][]`, or `#margin-note[]` at a cursor, plus
 * the import), and puts the cursor into the new note.
 */
export class CommentAction {
  /** The button, for the host's toolbar. */
  readonly button: HTMLButtonElement;

  constructor(private readonly root: HTMLElement, private readonly target: NoteTarget) {
    this.button = commentButton(root.ownerDocument);
    this.button.addEventListener('mousedown', (event) => event.preventDefault()); // keep the editor's selection
    this.button.addEventListener('click', () => this.comment());
    // Capture: the shortcut is ours before an editor (or an older listener) sees it.
    root.addEventListener('keydown', this.handleKey, true);
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
    this.root.removeEventListener('keydown', this.handleKey, true);
    this.button.remove();
  }

  private readonly handleKey = (event: KeyboardEvent): void => {
    if (event.code !== 'KeyM' || !event.altKey || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    event.stopPropagation();
    this.comment();
  };
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
