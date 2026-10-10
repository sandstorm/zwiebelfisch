import { Mark, Node, type Editor } from '@tiptap/core';
import type { Mark as PMMark, Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView, type NodeView } from '@tiptap/pm/view';
import { typstParser } from 'codemirror-lang-typst/lezer';

/**
 * `drafting` margin notes in the Visual view.
 *
 * - `marginNote`: a point note, `#margin-note(..)[note]`, an inline atom whose
 *   `src` is the whole call (printed verbatim, like a raw inline).
 * - `noteRange`: a range note, `#margin-note(..)[text][note]`, a mark over the
 *   (editable) text that keeps `call` (the source before the text's `[`) and
 *   `note` (the note's markup).
 *
 * Both show a bubble with the note (after the text of a range note). Clicking
 * the bubble edits the note's markup in place; Enter or leaving the field
 * writes it back (unbalanced brackets escaped, so the call stays intact),
 * Escape cancels. Everything outside the note's brackets stays as written.
 */
export const MarginNote = Node.create({
  name: 'marginNote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { src: { default: '#margin-note[]', rendered: false } };
  },
  renderHTML({ node }) {
    return ['span', { class: 'typst-visual__note' }, noteOf(node.attrs.src)];
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
    return { call: { default: '#margin-note', rendered: false }, note: { default: '', rendered: false } };
  },
  renderHTML() {
    return ['mark', { class: 'typst-visual__note-range' }, 0];
  },
  addProseMirrorPlugins() {
    return [rangeBubbles];
  },
});

/**
 * Opens the note editor of the note at document position `pos`: a point note
 * right after `pos`, or a range note whose text ends at `pos`. False if
 * there is none.
 */
export function editNoteAt(view: EditorView, pos: number): boolean {
  const point = view.state.doc.nodeAt(pos)?.type.name === 'marginNote' ? view.nodeDOM(pos) : null;
  const dom = point ?? [...view.dom.querySelectorAll('.typst-visual__note--range')].find((el) => bubbles.get(el)?.at() === pos);
  const bubble = dom ? bubbles.get(dom) : undefined;
  bubble?.edit();
  return bubble !== undefined;
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
    field.replaceWith(this.text);
    if (save && field.value !== this.target.note()) this.target.setNote(balanceBrackets(field.value));
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
      note: () => noteOf(this.node.attrs.src),
      setNote: (note) => {
        const pos = this.getPos();
        if (pos !== undefined) view.dispatch(view.state.tr.setNodeAttribute(pos, 'src', withNote(this.node.attrs.src, note)));
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

/** The note's markup in a point note's call: the inside of its last content block. */
function noteOf(src: string): string {
  const range = noteRange(src);
  return range ? src.slice(range.from, range.to) : '';
}

function withNote(src: string, note: string): string {
  const range = noteRange(src);
  return range ? src.slice(0, range.from) + note + src.slice(range.to) : src;
}

function noteRange(src: string): { from: number; to: number } | null {
  const block = typstParser.parse(src).topNode.getChild('FuncCall')?.getChild('Args')?.lastChild;
  if (block?.name !== 'ContentBlock' || block.lastChild?.name !== 'RightBracket') return null;
  return { from: block.from + 1, to: block.to - 1 };
}

/** Escapes `[` and `]` without a partner, so the note cannot end (or swallow) its call. */
export function balanceBrackets(markup: string): string {
  const open: number[] = [];
  const escape = new Set<number>();
  for (let i = 0; i < markup.length; i++) {
    if (markup[i] === '\\') i++;
    else if (markup[i] === '[') open.push(i);
    else if (markup[i] === ']' && open.pop() === undefined) escape.add(i);
  }
  for (const i of open) escape.add(i);
  return [...markup].map((c, i) => (escape.has(i) ? `\\${c}` : c)).join('');
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
    for (const span of noteSpans(node, pos + 1)) {
      decorations.push(Decoration.widget(span.to, (view) => rangeBubble(view, span), {
        side: -1,
        marks: [],
        key: `note:${span.from}:${span.to}:${span.mark.attrs.call}:${span.mark.attrs.note}`,
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

function rangeBubble(view: EditorView, { mark, from, to }: NoteSpan): HTMLElement {
  return new Bubble(view, {
    note: () => mark.attrs.note,
    setNote: (note) => {
      const tr = view.state.tr.removeMark(from, to, mark).addMark(from, to, mark.type.create({ ...mark.attrs, note }));
      view.dispatch(tr);
    },
    at: () => to,
  }, 'range').dom;
}
