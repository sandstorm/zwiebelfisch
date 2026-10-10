import { Mark, Node, type Editor } from '@tiptap/core';
import type { Mark as PMMark, Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView, type NodeView } from '@tiptap/pm/view';
import { NOTE_HEAD, rangeNoteSyntax, safeNote } from '../document/margin-note-syntax';
import { posToSource, print, sourceToPos } from './projection';

/**
 * `drafting` margin notes in the Visual view.
 *
 * - `marginNote`: a point note, `#margin-note(..)[note]`, an inline atom.
 * - `noteRange`: a range note, `#margin-note(..)[text][note]`, a mark over the
 *   (editable) text.
 *
 * Both keep `head` (the source before the first `[`, as written) and `note`
 * (the note's markup); `margin-note-syntax` reads and prints the call.
 *
 * Both show a bubble with the note (after the text of a range note). Clicking
 * the bubble edits the note's markup in place; Enter or leaving the field
 * writes it back (escaped where needed, so the call stays intact),
 * Escape cancels. Everything outside the note's brackets stays as written.
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
    return ({ node, editor, getPos }) => new PointNoteView(node, editor, getPos);
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
  addProseMirrorPlugins() {
    return [rangeBubbles];
  },
});

/**
 * Opens the note editor of the note whose source holds `offset` (in the
 * printed document): a point note's call, or the `][note]` part of a range
 * note. False if there is none.
 */
export function editNoteAt(view: EditorView, offset: number): boolean {
  const found = noteAt(view.state.doc, offset);
  const bubble = found ? bubbleOf(view, found) : undefined;
  bubble?.edit();
  return bubble !== undefined;
}

function bubbleOf(view: EditorView, { pos, id }: { pos: number; id?: unknown }): Bubble | undefined {
  if (id === undefined) {
    const dom = view.nodeDOM(pos);
    return dom ? bubbles.get(dom) : undefined;
  }
  for (const dom of view.dom.querySelectorAll('.typst-visual__note--range')) {
    const range = bubbleNotes.get(dom);
    if (range?.id === id && range.bubble.at() === pos) return range.bubble;
  }
  return undefined;
}

/**
 * The note whose source holds `offset`: a point note at `pos`, or the range
 * note `id` whose text ends at `pos`.
 */
function noteAt(doc: PMNode, offset: number): { pos: number; id?: unknown } | null {
  // hidden syntax maps to the next visible position: the end of the range note's text, or a point note's atom
  const pos = sourceToPos(doc, offset);
  if (doc.nodeAt(pos)?.type.name === 'marginNote' && posToSource(doc, pos) <= offset) return { pos };
  const $pos = doc.resolve(pos);
  // notes ending at the same place are nested; the inner one, numbered later, closes first
  const ending = noteSpans($pos.parent, $pos.start()).filter((span) => span.to === pos).sort((a, b) => b.mark.attrs.id - a.mark.attrs.id);
  const source = print(doc);
  let cursor = posToSource(doc, pos, -1);
  for (const { mark } of ending) {
    const { close } = rangeNoteSyntax(mark.attrs.head, mark.attrs.note);
    const at = source.indexOf(close, cursor);
    if (at < 0 || offset < at) return null;
    if (offset < at + close.length) return { pos, id: mark.attrs.id };
    cursor = at + close.length;
  }
  return null;
}

// ------------------------------------------------------------------ bubble

/** What a bubble edits: the note's markup, and where the outer cursor goes when done. */
interface BubbleTarget {
  note(): string;
  setNote(note: string): void;
  /** The document position after the note, or undefined once it is gone. */
  at(): number | undefined;
}

const bubbles = new WeakMap<object, Bubble>();
/** Range-note bubbles by their DOM, with the `id` of their note. */
const bubbleNotes = new WeakMap<object, { bubble: Bubble; id: unknown }>();

/** The marker showing a note's text, which turns into a text field when clicked. */
class Bubble {
  readonly dom: HTMLElement;
  private readonly text: HTMLElement;
  private field: HTMLTextAreaElement | null = null;

  constructor(private readonly view: EditorView, private readonly target: BubbleTarget, kind: 'point' | 'range') {
    const doc = view.dom.ownerDocument;
    this.dom = doc.createElement('span');
    this.dom.className = `typst-visual__note typst-visual__note--${kind}`;
    this.dom.contentEditable = 'false';
    this.dom.dataset.testid = 'typst-margin-note';
    this.dom.innerHTML = NOTE_ICON;
    this.text = this.dom.appendChild(doc.createElement('span'));
    this.text.className = 'typst-visual__note-text';
    this.show();
    this.dom.addEventListener('mousedown', (event) => {
      if (event.target === this.field) return;
      event.preventDefault();
      this.edit();
    });
    bubbles.set(this.dom, this);
  }

  /** Where the outer cursor goes after the note. */
  at(): number | undefined {
    return this.target.at();
  }

  get editing(): boolean {
    return this.field !== null;
  }

  /** Replaces the note text with a focused field holding the note's markup. */
  edit(): void {
    if (this.field) return this.field.focus();
    const field = this.dom.ownerDocument.createElement('textarea');
    field.className = 'typst-visual__note-field';
    field.rows = 1;
    field.value = this.target.note();
    field.setAttribute('aria-label', 'Note');
    field.addEventListener('keydown', (event) => this.key(event));
    field.addEventListener('blur', () => this.finish(true, false));
    this.field = field;
    this.text.replaceWith(field);
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }

  /** Shows the current note (when not being edited). */
  show(): void {
    if (this.field) return;
    const note = this.target.note();
    this.text.textContent = note;
    this.dom.title = note;
    this.dom.classList.toggle('typst-visual__note--empty', note.trim() === '');
  }

  private key(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) this.finish(true, true);
    else if (event.key === 'Escape') this.finish(false, true);
    else return;
    event.preventDefault();
  }

  /** Leaves the field, writing its text back if `save`; with `refocus`, the cursor goes after the note. */
  private finish(save: boolean, refocus: boolean): void {
    const field = this.field;
    if (!field) return;
    this.field = null;
    // a field taken out of the document (its note is gone) has nothing to save to
    if (!field.isConnected) return;
    field.replaceWith(this.text);
    const note = save && field.value !== this.target.note() ? safeNote(field.value) : null;
    if (note !== null) this.target.setNote(note);
    this.show();
    const pos = this.target.at();
    if (!refocus || pos === undefined) return;
    const { state } = this.view;
    this.view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(Math.min(pos, state.doc.content.size)))));
    this.view.focus();
  }
}

const NOTE_ICON =
  '<svg class="typst-visual__note-icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>';

// -------------------------------------------------------------- point note

class PointNoteView implements NodeView {
  readonly dom: HTMLElement;
  private readonly bubble: Bubble;

  constructor(private node: PMNode, editor: Editor, private readonly getPos: () => number | undefined) {
    const { view } = editor;
    this.bubble = new Bubble(view, {
      note: () => this.node.attrs.note,
      setNote: (note) => {
        const pos = this.getPos();
        if (pos !== undefined) view.dispatch(view.state.tr.setNodeAttribute(pos, 'note', note));
      },
      at: () => {
        const pos = this.getPos();
        return pos === undefined ? undefined : pos + 1;
      },
    }, 'point');
    this.dom = this.bubble.dom;
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.bubble.show();
    return true;
  }

  stopEvent(event: Event): boolean {
    return this.bubble.editing || event.type === 'mousedown';
  }

  ignoreMutation(): boolean {
    return true;
  }
}

// -------------------------------------------------------------- range note

const rangeKey = new PluginKey<DecorationSet>('typst-note-ranges');

/** A bubble after the text of every range note. */
const rangeBubbles = new Plugin<DecorationSet>({
  key: rangeKey,
  state: {
    init: (_config, state) => rangeDecorations(state.doc),
    apply: (tr, set) => (tr.docChanged ? rangeDecorations(tr.doc) : set),
  },
  props: {
    decorations: (state) => rangeKey.getState(state),
  },
});

interface NoteSpan {
  mark: PMMark;
  from: number;
  to: number;
}

function rangeDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.inlineContent) return true;
    for (const { mark, to } of noteSpans(node, pos + 1)) {
      decorations.push(Decoration.widget(to, (view) => rangeBubble(view, mark), {
        side: -1,
        marks: [],
        // no positions: the bubble (and an open editor in it) stays while text around it changes
        key: `note:${mark.attrs.id}:${mark.attrs.head}:${mark.attrs.note}`,
        stopEvent: () => true,
        ignoreSelection: true,
      }));
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/** The stretches of a textblock (content starting at `start`) covered by each range note. */
function noteSpans(block: PMNode, start: number): NoteSpan[] {
  const done: NoteSpan[] = [];
  let open: NoteSpan[] = [];
  block.forEach((child, offset) => {
    const pos = start + offset;
    const notes = child.marks.filter((m) => m.type.name === 'noteRange');
    done.push(...open.filter((span) => !span.mark.isInSet(notes)));
    open = open.filter((span) => span.mark.isInSet(notes));
    for (const mark of notes) if (!open.some((span) => span.mark.eq(mark))) open.push({ mark, from: pos, to: pos });
    for (const span of open) span.to = pos + child.nodeSize;
  });
  return [...done, ...open];
}

/** The bubble of the range note `mark`; it finds the note's current text when it needs it. */
function rangeBubble(view: EditorView, mark: PMMark): HTMLElement {
  const span = (): NoteSpan | undefined => currentSpan(view, bubble.dom, mark);
  const bubble: Bubble = new Bubble(view, {
    note: () => mark.attrs.note,
    setNote: (note) => {
      const at = span();
      if (!at) return;
      view.dispatch(view.state.tr.removeMark(at.from, at.to, at.mark).addMark(at.from, at.to, mark.type.create({ ...at.mark.attrs, note })));
    },
    at: () => span()?.to,
  }, 'range');
  bubbleNotes.set(bubble.dom, { bubble, id: mark.attrs.id });
  return bubble.dom;
}

/** The text of the range note shown by `bubble` (the widget after it) in the current document, if it is still there. */
function currentSpan(view: EditorView, bubble: HTMLElement, mark: PMMark): NoteSpan | undefined {
  if (!bubble.isConnected) return undefined;
  let to: number;
  try {
    to = view.posAtDOM(bubble, 0);
  } catch {
    return undefined;
  }
  const $to = view.state.doc.resolve(to);
  return noteSpans($to.parent, $to.start()).find((span) => span.to === to && span.mark.attrs.id === mark.attrs.id);
}
