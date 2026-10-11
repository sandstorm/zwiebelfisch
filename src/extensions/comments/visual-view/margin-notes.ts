// Margin notes (drafting) in the text: point notes and range notes, and the "Comment" toolbar action. See
// visual-view.ts.
import type { SyntaxNode } from '@lezer/common';
import { Mark, Node } from '@tiptap/core';
import type { Mark as PMMark, Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { NodeView } from '@tiptap/pm/view';
import { NOTE_HEAD, noteCallSyntax, printNoteCall, rangeNoteSyntax } from '../model/margin-note-syntax';
import { children } from '../../../core/typst-syntax/typst-syntax';
import { svg, type Action, type TypstMarkSpec, type TypstNodeSpec, type VisualViewContribution } from '../../../hosts/visual-view/visual-view';
import type { Placed, ProjectionContext } from '../../../hosts/projection/projection';

export interface MarginNotesOptions {
  /** Adds a comment (margin note) at the selection: the "Comment" button in the toolbar and the selection's bar. */
  comment(): void;
}

/** A note range's mark priority: outermost where it covers the same text as another mark (links: 120). */
const NOTE_RANGE_PRIORITY = 130;

/**
 * `drafting` margin notes in the Visual view. A margin note call (as
 * `noteCallSyntax` defines it) belongs in running text:
 *
 * - `marginNote`: a point note, `#margin-note(..)[note]`, an inline atom shown
 *   as a small marker (a box: a remote caret inside outlines it).
 * - `noteRange`: a range note, `#margin-note(..)[text][note]`, a mark over the
 *   (editable) projected text, shown highlighted.
 *
 * Both keep `head` (the source before the first `[`, as written) and `note`
 * (the note's markup), printed by `margin-note-syntax`; `noteRange` also has
 * an unprinted `id`, the note's number in its textblock, so equal neighbouring
 * notes stay two marks (`excludes: ''`, so notes nest). Other `margin-note`
 * calls stay raw. The notes themselves are shown and edited in the notes
 * gutter (`notes-gutter/`).
 */
export function marginNotes(options: MarginNotesOptions): VisualViewContribution {
  return {
    id: 'margin-notes',
    activate({ visualView, subscriptions }) {
      const action = commentAction(options.comment);
      subscriptions.push(
        visualView.registerNode(MARGIN_NOTE),
        visualView.registerMark(NOTE_RANGE, { priority: NOTE_RANGE_PRIORITY }),
        visualView.registerToolbarGroup({ kind: 'group', id: 'comments', order: 60 }),
        visualView.registerToolbarItem({ group: 'comments', action }),
        visualView.registerToolbarItem({ group: 'selection', order: 50, action }),
      );
    },
  };
}

const MarginNote = Node.create({
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

const NoteRange = Mark.create({
  name: 'noteRange',
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

const MARGIN_NOTE: TypstNodeSpec = {
  name: 'marginNote',
  extension: MarginNote,
  box: 'widget',
  inlineCalls: [{ matches: (p, call) => noteCallSyntax(p.source, call) !== null, project: marginNoteCall }],
  printAtom: (node) => printNoteCall(node.attrs as { head: string; note: string }),
};

const NOTE_RANGE: TypstMarkSpec = {
  name: 'noteRange',
  extension: NoteRange,
  print: (mark) => rangeNoteSyntax(mark.attrs.head, mark.attrs.note),
};

/**
 * `#margin-note(..named)[note]` → a `marginNote` atom holding the call's head
 * and note; `#margin-note(..named)[text][note]` → `text` with a `noteRange`
 * mark holding them. Null for calls that are not margin notes.
 */
function marginNoteCall(p: ProjectionContext, call: SyntaxNode, marks: readonly PMMark[]): PMNode | Placed[] | null {
  const syntax = noteCallSyntax(p.source, call);
  if (!syntax) return null;
  const { head, text, note } = syntax;
  if (!text) return p.schema.nodes.marginNote.create({ head, note }, null, marks);
  const mark = p.schema.marks.noteRange.create({ head, note, id: p.serial() });
  return p.inline(children(text.getChild('Markup')!), mark.addToSet(marks));
}

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

const COMMENT_ICON = svg('<path d="M4 5h16v11h-9l-5 4v-4H4z"/>');

/** "Comment": enabled with a caret or selection in text (not in a code block or on a selected box). */
function commentAction(comment: () => void): Action {
  return {
    label: 'Comment',
    shortcut: 'Mod+Alt+M',
    icon: COMMENT_ICON,
    run: (c) => c,
    click: () => comment(),
    enabled: (editor) => {
      const { selection } = editor.state;
      const { parent } = selection.$from;
      return selection instanceof TextSelection && parent.inlineContent && !parent.type.spec.code;
    },
  };
}
