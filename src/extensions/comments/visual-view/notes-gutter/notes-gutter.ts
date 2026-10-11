// NotesGutter: the comment column of the Visual view, a card per margin note. See docs/guide/features.typ.
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { TypstDocument } from '../../../../core/typst-document/typst-document';
import { addReply, deleteMessage, editMessage, localDate } from '../../model/note-thread';
import { layoutCards } from '../../model/card-layout';
import { safeNote } from '../../model/margin-note-syntax';
import type { VisualViewContribution } from '../../../../hosts/visual-view/visual-view';
import { type CardActions, NoteCard } from './note-card';
import { findNotes, followNotes, noteAtOffset, noteAtSelection, removeNote, setNoteText, type KeyedNote } from './note-list';

export interface NotesGutterOptions {
  /** Who writes replies: the name signs them, and only own messages can be edited (default: "Anonymous"). */
  user?: { name: string };
}

/** The notes gutter as a contribution, and a way to its cards (the Comment action opens the new note's card). */
export interface NotesGutterContribution extends VisualViewContribution {
  /**
   * Focuses the card of the margin note whose source contains `offset` (a
   * point note, or the note part of a range note) in the Visual view of
   * `document`. False if there is none.
   */
  editNote(document: TypstDocument, offset: number): boolean;
}

/** A notes gutter (see `NotesGutter`) beside the text of every Visual view. */
export function notesGutter(options: NotesGutterOptions = {}): NotesGutterContribution {
  const gutters = new Map<TypstDocument, NotesGutter>();
  return {
    id: 'notes-gutter',
    activate({ visualView, subscriptions }) {
      subscriptions.push(
        visualView.registerGutter((view, body) => {
          const gutter = new NotesGutter(body, options);
          gutters.set(view.document, gutter);
          return {
            plugin: gutter.plugin,
            dispose: () => {
              if (gutters.get(view.document) === gutter) gutters.delete(view.document);
              gutter.dispose();
            },
          };
        }),
      );
    },
    editNote: (document, offset) => gutters.get(document)?.edit(offset) ?? false,
  };
}

/**
 * The comment gutter of the Visual view: a column right of the text with a
 * card for every margin note, next to its anchor (a point note's marker, a
 * range note's highlighted text) and pushed down where cards would overlap.
 *
 * - A card shows the note as a thread (see `readThread`) and has a reply
 *   box: Mod+Enter appends a message signed with the user's name and today's
 *   date. Own messages can be edited, the last own one deleted. Every change
 *   is one undo step and keeps the call intact. "Resolve" deletes the note:
 *   a point note's call, or a range note's call around its text (the text stays).
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
class NotesGutter {
  readonly plugin: Plugin<GutterState>;
  private readonly root: HTMLElement;
  private readonly cards = new Map<string, NoteCard>();
  private view: EditorView | null = null;
  private shown: GutterState | null = null;
  private frame = 0;
  private readonly resize: ResizeObserver | null = null;

  private readonly me: string;

  constructor(private readonly body: HTMLElement, options: NotesGutterOptions = {}) {
    const doc = body.ownerDocument;
    this.me = options.user?.name.trim() || 'Anonymous';
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

  dispose(): void {
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
    this.body.classList.toggle('typst-comments--notes', state.notes.length > 0);
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
        card = new NoteCard(this.root.ownerDocument, note.key, this.me, this.cardActions);
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
    reply: (key, text) => this.rewrite(key, (note) => addReply(note, { author: this.me, date: localDate(), text })),
    edit: (key, index, text) => this.rewrite(key, (note) => editMessage(note, index, text)),
    deleteMessage: (key, index) => {
      const note = this.note(key);
      if (note && deleteMessage(note.note, index) === '') this.cardActions.remove(key);
      else this.rewrite(key, (markup) => deleteMessage(markup, index));
    },
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

  /** Replaces the note's markup with `next(markup)` (one step), unless null, unchanged or unsafe for the call. */
  private rewrite(key: string, next: (markup: string) => string | null): void {
    this.change(key, (tr, note) => {
      const markup = next(note.note);
      const safe = markup === null ? null : safeNote(markup);
      return safe === null || safe !== markup || safe === note.note ? null : setNoteText(tr, note, safe);
    });
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
    this.body.classList.toggle('typst-comments--narrow', narrow);
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

/**
 * Below this width of the text and gutter together, cards become popovers.
 * Half of a 1280px window, next to the side panels' rail, is about 620px:
 * there the column still fits, leaving 300px and more for the text.
 */
const NARROW_PX = 560;
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
          const marker = (event.target as Element).closest?.('.typst-comments__note');
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
    const flags = `${key === active ? ' typst-comments__anchor--active' : ''}${key === hover ? ' typst-comments__anchor--hover' : ''}`;
    const attrs = { 'data-note-key': key, class: `typst-comments__anchor${flags}` };
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
