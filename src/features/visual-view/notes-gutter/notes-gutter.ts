import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { safeNote } from '../../comments/comments';
import { layoutCards } from './card-layout';
import { findNotes, followNotes, noteAtOffset, noteAtSelection, removeNote, setNoteText, type KeyedNote } from './note-list';

/**
 * The comment gutter of the Visual view: a column right of the text with a
 * card for every margin note, next to its anchor (a point note's marker, a
 * range note's highlighted text) and pushed down where cards would overlap.
 *
 * - A card holds the note's markup in a text area: Mod+Enter or leaving it
 *   saves (escaped where needed, so the call stays intact; one undo step),
 *   Escape cancels. "Resolve" deletes the note: a point note's call, or a
 *   range note's call around its text (the text stays).
 * - The note at the cursor (or a clicked marker, or a focused card) is
 *   active: its card sits exactly at its anchor and both are highlighted;
 *   hovering either highlights both.
 * - A card follows its note while text around it changes, also while it is
 *   being edited (changes from elsewhere do not touch the text area's value);
 *   a card whose note is gone saves nothing.
 * - Layout is measured in an animation frame, only after the document, the
 *   cards or the size of the text changed. On a narrow pane the gutter
 *   collapses: only the active note's card shows, as a popover below its anchor.
 *
 * Add `plugin` to the editor's state; the gutter column goes into `body`,
 * next to the editor's DOM.
 */
export class NotesGutter {
  readonly plugin: Plugin<GutterState>;
  private readonly root: HTMLElement;
  private readonly cards = new Map<string, NoteCard>();
  private view: EditorView | null = null;
  private shown: GutterState | null = null;
  private frame = 0;
  private readonly resize: ResizeObserver | null = null;

  constructor(private readonly body: HTMLElement) {
    const doc = body.ownerDocument;
    this.root = body.appendChild(doc.createElement('aside'));
    this.root.className = 'typst-notes-gutter';
    this.root.setAttribute('aria-label', 'Notes');
    this.plugin = gutterPlugin({
      attach: (view) => this.attach(view),
      update: () => this.render(),
      detach: () => {
        this.view = null;
      },
      focus: (key) => this.focus(key),
    });
    const win = doc.defaultView;
    if (win && 'ResizeObserver' in win) this.resize = new win.ResizeObserver(() => this.schedule());
    this.resize?.observe(body);
    // images in the text change its height once loaded (`load` does not bubble: capture)
    body.addEventListener('load', this.schedule, true);
  }

  /** Focuses the card of the note whose source holds `offset` (a point note's call, a range note's `][note]`); false if none. */
  edit(offset: number): boolean {
    const view = this.view;
    const note = view ? noteAtOffset(gutterKey.getState(view.state)!.notes, view.state.doc, offset) : undefined;
    if (note) this.focus(note.key);
    return note !== undefined;
  }

  destroy(): void {
    this.resize?.disconnect();
    this.body.removeEventListener('load', this.schedule, true);
    if (this.frame) this.body.ownerDocument.defaultView?.cancelAnimationFrame(this.frame);
    this.root.remove();
  }

  private attach(view: EditorView): void {
    this.view = view;
    this.resize?.observe(view.dom);
    this.render();
  }

  private state(): GutterState | undefined {
    return this.view ? gutterKey.getState(this.view.state) : undefined;
  }

  /** Brings the cards in line with the plugin state. */
  private render(): void {
    const state = this.state();
    const shown = this.shown;
    if (!state || state === shown) return;
    this.shown = state;
    if (state.notes !== shown?.notes) this.renderCards(state.notes);
    // no notes, no gutter column
    this.body.classList.toggle('typst-visual__body--notes', state.notes.length > 0);
    for (const [key, card] of this.cards) card.highlight(key === state.active, key === state.hover);
    // anchors move with the document (notes are found anew on every change); the active card aligns
    if (state.notes !== shown?.notes || state.active !== shown?.active) this.schedule();
  }

  private renderCards(notes: readonly KeyedNote[]): void {
    const keys = new Set(notes.map((note) => note.key));
    for (const [key, card] of this.cards) {
      if (keys.has(key)) continue;
      card.dom.remove();
      this.cards.delete(key);
    }
    let previous: HTMLElement | null = null;
    for (const note of notes) {
      let card = this.cards.get(note.key);
      if (!card) {
        card = new NoteCard(this.root.ownerDocument, note.key, this.cardActions);
        this.cards.set(note.key, card);
      }
      card.show(note);
      // document order is tab order; move only what is out of place
      const next: ChildNode | null = previous ? previous.nextSibling : this.root.firstChild;
      if (next !== card.dom) this.root.insertBefore(card.dom, next);
      previous = card.dom;
    }
  }

  private readonly cardActions: CardActions = {
    save: (key, markup) => this.change(key, (tr, note) => {
      const safe = safeNote(markup);
      return safe === null || safe === note.note ? null : setNoteText(tr, note, safe);
    }),
    remove: (key) => {
      const at = this.note(key)?.from;
      this.change(key, (tr, note) => removeNote(tr, note));
      if (at !== undefined) this.returnTo(at);
    },
    done: (key) => {
      const at = this.note(key)?.to;
      if (at !== undefined) this.returnTo(at);
    },
    activate: (key) => this.setMeta({ active: key }),
    hover: (key) => this.setMeta({ hover: key }),
    resized: () => this.schedule(),
  };

  private note(key: string): KeyedNote | undefined {
    return this.state()?.notes.find((note) => note.key === key);
  }

  private change(key: string, edit: (tr: Transaction, note: KeyedNote) => Transaction | null): void {
    const view = this.view;
    const note = this.note(key);
    const tr = view && note ? edit(view.state.tr, note) : null;
    if (view && tr) view.dispatch(tr);
  }

  /** Puts the text cursor at `pos` (clamped) and focuses the text. */
  private returnTo(pos: number): void {
    const view = this.view;
    if (!view) return;
    const { doc } = view.state;
    view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(Math.min(pos, doc.content.size)))));
    view.focus();
  }

  private setMeta(meta: GutterMeta): void {
    const state = this.state();
    if (!this.view || !state) return;
    if (('active' in meta && meta.active !== state.active) || ('hover' in meta && meta.hover !== state.hover)) {
      this.view.dispatch(this.view.state.tr.setMeta(gutterKey, meta));
    }
  }

  private focus(key: string): void {
    // active first: on a narrow pane only the active card is shown (and focusable)
    this.setMeta({ active: key });
    this.cards.get(key)?.focus();
  }

  private readonly schedule = (): void => {
    const win = this.body.ownerDocument.defaultView;
    if (this.frame || !win) return;
    this.frame = win.requestAnimationFrame(() => {
      this.frame = 0;
      this.layout();
    });
  };

  /** Measures anchors and cards (all reads first), then places the cards. */
  private layout(): void {
    const state = this.state();
    const view = this.view;
    if (!state || !view) return;
    const width = this.body.clientWidth;
    const narrow = width > 0 && width < NARROW_PX;
    this.body.classList.toggle('typst-visual__body--narrow', narrow);
    const origin = this.root.getBoundingClientRect().top;
    const measured = state.notes.map((note) => {
      const anchor = view.dom.querySelector(`[data-note-key="${note.key}"]`)?.getBoundingClientRect();
      const card = this.cards.get(note.key)!;
      return { card, anchor: (narrow ? anchor?.bottom : anchor?.top) ?? origin, height: card.dom.offsetHeight };
    });
    const boxes = measured.map(({ anchor, height }) => ({ anchor: anchor - origin + (narrow ? POPOVER_GAP_PX : 0), height }));
    const active = state.notes.findIndex((note) => note.key === state.active);
    const tops = narrow ? boxes.map((box) => box.anchor) : layoutCards(boxes, { gap: CARD_GAP_PX, active: active < 0 ? undefined : active, top: 0 });
    measured.forEach(({ card }, i) => card.place(tops[i]));
    const bottom = Math.max(0, ...tops.map((top, i) => top + boxes[i].height));
    this.root.style.minHeight = narrow || bottom === 0 ? '' : `${bottom}px`;
  }
}

/** Below this width of the text and gutter together, cards become popovers. */
const NARROW_PX = 640;
const CARD_GAP_PX = 8;
const POPOVER_GAP_PX = 4;

// ------------------------------------------------------------------ plugin

interface GutterState {
  notes: KeyedNote[];
  /** The key of the active note, if any. */
  active: string | null;
  /** The key of the note under the mouse (text or card), if any. */
  hover: string | null;
  decorations: DecorationSet;
}

type GutterMeta = { active?: string | null; hover?: string | null };

const gutterKey = new PluginKey<GutterState>('typst-notes-gutter');

interface GutterHooks {
  attach(view: EditorView): void;
  update(): void;
  detach(): void;
  focus(key: string): void;
}

function gutterPlugin(hooks: GutterHooks): Plugin<GutterState> {
  let next = 0;
  const newKey = () => `n${next++}`;
  return new Plugin<GutterState>({
    key: gutterKey,
    state: {
      init: (_config, state) => withDecorations(state, {
        notes: followNotes([], { map: (pos) => pos }, findNotes(state.doc), newKey),
        active: null,
        hover: null,
      }),
      apply: (tr, previous, _old, state) => nextState(tr, previous, state, newKey),
    },
    props: {
      decorations: (state) => gutterKey.getState(state)?.decorations,
      handleDOMEvents: {
        mouseover: (view, event) => hoverAnchor(view, anchorKey(event.target)),
        mouseleave: (view) => hoverAnchor(view, null),
        mousedown: (_view, event) => {
          // a point note's marker has no text to click into: it opens the card
          const marker = (event.target as Element).closest?.('.typst-visual__note');
          const key = marker ? anchorKey(marker) : null;
          if (!key) return false;
          event.preventDefault();
          hooks.focus(key);
          return true;
        },
      },
    },
    view: (view) => {
      hooks.attach(view);
      return { update: () => hooks.update(), destroy: () => hooks.detach() };
    },
  });
}

function nextState(tr: Transaction, previous: GutterState, state: EditorState, newKey: () => string): GutterState {
  const notes = tr.docChanged ? followNotes(previous.notes, tr.mapping, findNotes(tr.doc), newKey) : previous.notes;
  const meta: GutterMeta = tr.getMeta(gutterKey) ?? {};
  const exists = (key: string | null | undefined) => (key && notes.some((note) => note.key === key) ? key : null);
  const active = exists('active' in meta ? meta.active : tr.selectionSet ? noteAtSelection(notes, tr.selection)?.key : previous.active);
  const hover = exists('hover' in meta ? meta.hover : previous.hover);
  if (notes === previous.notes && active === previous.active && hover === previous.hover) return previous;
  return withDecorations(state, { notes, active, hover });
}

/** The anchors: `data-note-key` on every note's marker or highlighted text, plus the active and hover classes. */
function withDecorations(state: EditorState, { notes, active, hover }: Omit<GutterState, 'decorations'>): GutterState {
  const decorations = notes.map(({ key, kind, from, to }) => {
    const flags = `${key === active ? ' typst-visual__note-anchor--active' : ''}${key === hover ? ' typst-visual__note-anchor--hover' : ''}`;
    const attrs = { 'data-note-key': key, class: `typst-visual__note-anchor${flags}` };
    return kind === 'point' ? Decoration.node(from, to, attrs) : Decoration.inline(from, to, attrs);
  });
  return { notes, active, hover, decorations: DecorationSet.create(state.doc, decorations) };
}

function anchorKey(target: EventTarget | null): string | null {
  return (target as Element | null)?.closest?.('[data-note-key]')?.getAttribute('data-note-key') ?? null;
}

function hoverAnchor(view: EditorView, key: string | null): boolean {
  if (gutterKey.getState(view.state)?.hover !== key) view.dispatch(view.state.tr.setMeta(gutterKey, { hover: key }));
  return false;
}

// -------------------------------------------------------------------- card

interface CardActions {
  /** Writes `markup` into the note (nothing if the note is gone or unchanged). */
  save(key: string, markup: string): void;
  remove(key: string): void;
  /** Editing is over: the text cursor goes after the note. */
  done(key: string): void;
  activate(key: string): void;
  hover(key: string | null): void;
  resized(): void;
}

/** One note's card: what it highlights, its markup in a text area, and a resolve button. */
class NoteCard {
  readonly dom: HTMLElement;
  private readonly quote: HTMLElement;
  private readonly field: HTMLTextAreaElement;
  /** The note's markup as last shown, for Escape and to tell whether the field changed. */
  private markup = '';

  constructor(doc: Document, private readonly key: string, private readonly actions: CardActions) {
    this.dom = doc.createElement('div');
    this.dom.className = 'typst-note-card';
    this.dom.dataset.testid = 'typst-note-card';
    this.dom.dataset.noteKey = key;
    this.dom.innerHTML = CARD_HTML;
    this.quote = this.dom.querySelector('.typst-note-card__quote')!;
    this.field = this.dom.querySelector('textarea')!;
    const resolve = this.dom.querySelector<HTMLButtonElement>('.typst-note-card__resolve')!;
    // keep the field's focus: resolving must not save first (two undo steps)
    resolve.addEventListener('mousedown', (event) => event.preventDefault());
    resolve.addEventListener('click', () => actions.remove(key));
    // a click anywhere on the card (but the field and the button) edits the note
    this.dom.addEventListener('mousedown', (event) => {
      if ((event.target as Element).closest('textarea, button')) return;
      event.preventDefault();
      this.focus();
    });
    this.dom.addEventListener('mouseenter', () => actions.hover(key));
    this.dom.addEventListener('mouseleave', () => actions.hover(null));
    this.field.addEventListener('focus', () => actions.activate(key));
    this.field.addEventListener('blur', () => this.save());
    this.field.addEventListener('input', () => actions.resized());
    this.field.addEventListener('keydown', (event) => this.handleKey(event));
  }

  /** Shows `note`; a field being edited keeps what the user typed. */
  show(note: KeyedNote): void {
    this.dom.classList.toggle('typst-note-card--range', note.kind === 'range');
    this.quote.textContent = note.kind === 'range' ? note.text : 'Note';
    this.quote.title = note.kind === 'range' ? note.text : '';
    this.markup = note.note;
    if (!this.editing && this.field.value !== note.note) {
      this.field.value = note.note;
      this.actions.resized();
    }
  }

  highlight(active: boolean, hover: boolean): void {
    this.dom.classList.toggle('typst-note-card--active', active);
    this.dom.classList.toggle('typst-note-card--hover', hover);
  }

  focus(): void {
    this.field.focus();
    this.field.setSelectionRange(this.field.value.length, this.field.value.length);
  }

  place(top: number): void {
    this.dom.style.top = `${Math.round(top)}px`;
  }

  private get editing(): boolean {
    // the root's active element: inside <typst-editor>'s shadow root, the document's is the host
    return (this.field.getRootNode() as Document | ShadowRoot).activeElement === this.field;
  }

  private save(): void {
    if (this.field.value !== this.markup) this.actions.save(this.key, this.field.value);
    // what was saved (maybe escaped), or the old note if nothing could be
    if (!this.editing) this.field.value = this.markup;
  }

  private handleKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      this.save();
    } else if (event.key === 'Escape') {
      this.field.value = this.markup;
    } else {
      return;
    }
    event.preventDefault();
    this.actions.done(this.key);
  }
}

const ICON =
  '<svg class="typst-note-card__icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>';
const CHECK =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>';
const CARD_HTML =
  `<div class="typst-note-card__head">${ICON}<span class="typst-note-card__quote"></span>`
  + `<button type="button" class="typst-note-card__resolve" aria-label="Resolve note" title="Resolve: delete the note (Typst: removes the margin-note call)">${CHECK}</button></div>`
  + '<textarea class="typst-note-card__field" rows="2" aria-label="Note" placeholder="Write a note…"></textarea>';
