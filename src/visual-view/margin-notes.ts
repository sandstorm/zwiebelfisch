import { Mark, Node } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';
import { NOTE_HEAD } from '../document/margin-note-syntax';

/**
 * `drafting` margin notes in the Visual view's schema.
 *
 * - `marginNote`: a point note, `#margin-note(..)[note]`, an inline atom shown
 *   as a small marker.
 * - `noteRange`: a range note, `#margin-note(..)[text][note]`, a mark over the
 *   (editable) text, shown highlighted.
 *
 * Both keep `head` (the source before the first `[`, as written) and `note`
 * (the note's markup); `margin-note-syntax` reads and prints the call. The
 * notes themselves are shown and edited in the notes gutter
 * (`notes-gutter.ts`).
 */
export const MarginNote = Node.create({
  name: 'marginNote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { head: { default: NOTE_HEAD, rendered: false }, note: { default: '', rendered: false } };
  },
  renderHTML({ node }) {
    return ['span', { class: 'typst-visual__note' }, node.attrs.note];
  },
  addNodeView() {
    return ({ node, editor }) => new PointNoteMarker(node, editor.view.dom.ownerDocument);
  },
});

export const NoteRange = Mark.create({
  name: 'noteRange',
  // outermost when it covers the same text as another mark
  priority: 1001,
  inclusive: false,
  excludes: '',
  addAttributes() {
    return {
      head: { default: NOTE_HEAD, rendered: false },
      note: { default: '', rendered: false },
      // tells apart notes in one textblock (numbered by the projection), so equal neighbours do not merge
      id: { default: null, rendered: false },
    };
  },
  renderHTML() {
    return ['mark', { class: 'typst-visual__note-range' }, 0];
  },
});

/** A point note in the text: a speech-bubble icon with the note as its tooltip. */
class PointNoteMarker implements NodeView {
  readonly dom: HTMLElement;

  constructor(private node: PMNode, doc: Document) {
    this.dom = doc.createElement('span');
    this.dom.className = 'typst-visual__note';
    this.dom.contentEditable = 'false';
    this.dom.dataset.testid = 'typst-note-marker';
    this.dom.innerHTML = NOTE_ICON;
    this.show();
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.show();
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }

  private show(): void {
    const note: string = this.node.attrs.note;
    this.dom.title = note.trim() === '' ? 'Empty note' : note;
    this.dom.classList.toggle('typst-visual__note--empty', note.trim() === '');
  }
}

const NOTE_ICON =
  '<svg class="typst-visual__note-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>';
