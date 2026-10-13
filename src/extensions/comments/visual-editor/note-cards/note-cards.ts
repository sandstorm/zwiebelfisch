// The floating card of a margin note in the Visual editor (NoteCardPopover, below). See comments in ../../comments.ts.
import { Extension } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey, TextSelection, type EditorState, type Selection, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { SourceOffset, TypstDocument } from '../../../../core/typst-document/typst-document';
import { addReply, deleteMessage, editMessage, firstWords, localDate, readThread } from '../../model/note-thread';
import { safeNote } from '../../model/margin-note-syntax';
import type { VisualEditorContribution } from '../../../../hosts/visual-editor/visual-editor';
import { NOTE_ICON } from '../margin-notes';
import { type CardActions, NoteCard } from './note-card';
import { findNotes, followNotes, noteAtOffset, noteAtSelection, removeNote, setNoteText, type KeyedNote } from './note-list';

/** The floating note card (see `NoteCardPopover`) in every Visual editor. */
export function noteCards(options: NoteCardsOptions = {}): NoteCardsContribution {
  const popovers = new Map<TypstDocument, NoteCardPopover>();
  const me = () => options.user?.name.trim() || 'Anonymous';
  return {
    id: 'note-cards',
    activate({ visualEditor, subscriptions }) {
      subscriptions.push(
        visualEditor.registerTiptapExtension(({ document }) =>
          Extension.create({
            name: 'noteCards',
            addProseMirrorPlugins: () => [
              cardsPlugin((view) => {
                const popover = new NoteCardPopover(view, me);
                popovers.set(document, popover);
                popover.onDispose = () => {
                  if (popovers.get(document) === popover) popovers.delete(document);
                };
                return popover;
              }),
            ],
          })),
      );
    },
    editNote: (document, offset) => popovers.get(document)?.openAt(offset) ?? false,
  };
}

export interface NoteCardsOptions {
  /**
   * Who writes replies: the name signs them, and only own messages can be edited (default: "Anonymous"). Read each
   * time, so it may change (a getter: the workbench's user, once signed in at a server).
   */
  readonly user?: { name: string };
}

/** The note cards as a contribution, and a way to open one (the Comment action opens the new note's card). */
export interface NoteCardsContribution extends VisualEditorContribution {
  /**
   * Opens and focuses the card of the margin note whose source contains
   * `offset` (a point note, or the note part of a range note) in the Visual
   * editor of `document`. False if there is none.
   */
  editNote(document: TypstDocument, offset: SourceOffset): boolean;
}

/**
 * A margin note's thread as a card floating below the note's marker (a
 * speech bubble: a point note itself, or one at the end of a range note's
 * highlighted text), one card at a time.
 *
 * - The marker's tooltip names the first message's author and words.
 * - Clicking a marker, Alt+Enter at a note, or `openAt` opens the card with
 *   the focus in its reply box (see `NoteCard`). A click into highlighted text
 *   opens it while the focus stays in the text; it closes when the caret
 *   leaves the note.
 * - Escape or "Close" closes it and puts the focus back into the text; a
 *   press elsewhere closes it, too. Closing sends a new note's first message.
 * - Every change is one undo step and keeps the call intact. "Resolve"
 *   deletes the note: a point note's call, or a range note's call around its
 *   text (the text stays).
 * - The card follows its note while text around it changes, here or from
 *   elsewhere (a collaborator's reply shows at once); it closes when its note
 *   is gone. A card keeps its drafts while its note exists.
 *
 * The card is an inline popover at the content (as the table bar or the image
 * tools), not one of the window's: those are one-shot (a quick input, a menu)
 * and close on the next change, a card stays open and live.
 */
class NoteCardPopover {
  /** Run when the editor's view goes. */
  onDispose: () => void = () => {};
  /** The text column, `position: relative`: the card scrolls with the text. */
  private readonly container: HTMLElement;
  private readonly cards = new Map<string, NoteCard>();
  private shown: CardsState | null = null;
  /** The card shown (that of the open note), if any. */
  private current: NoteCard | undefined;
  private readonly resize: ResizeObserver | null = null;

  constructor(private readonly view: EditorView, private readonly me: () => string) {
    this.container = view.dom.parentElement!;
    const win = this.container.ownerDocument.defaultView;
    if (win && 'ResizeObserver' in win) this.resize = new win.ResizeObserver(() => this.place());
    this.resize?.observe(this.container);
    this.update();
  }

  /** Opens and focuses the card of the note whose source holds `offset` (a point note's call, a range note's `][note]`); false if none. */
  openAt(offset: SourceOffset): boolean {
    const { view } = this;
    const note = noteAtOffset(this.state().notes, view.state.doc, offset);
    if (note) this.open(note.key, true);
    return note !== undefined;
  }

  /** Opens the card of note `key`, focused or with the focus left where it is. */
  open(key: string, focus: boolean): void {
    const open = this.state().open;
    if (open !== null && open !== key) this.cards.get(open)?.commit();
    if (this.state().open !== key) this.view.dispatch(this.view.state.tr.setMeta(cardsKey, { open: key } satisfies CardsMeta));
    if (focus) this.cards.get(key)?.focus();
  }

  /** Closes the open card (sending a new note's first message); with `refocus`, the focus goes back to the text. */
  close(refocus: boolean): void {
    const key = this.state().open;
    if (key === null) return;
    this.cards.get(key)?.commit();
    const note = this.note(key);
    this.view.dispatch(this.view.state.tr.setMeta(cardsKey, { open: null } satisfies CardsMeta));
    if (refocus && note) this.returnTo(note);
  }

  /** Whether the focus is in the open card. */
  focused(): boolean {
    return hasFocus(this.current?.dom);
  }

  /** Brings the cards in line with the plugin state. */
  update(): void {
    const state = this.state();
    if (state === this.shown) return;
    if (state.notes !== this.shown?.notes) this.forgetGone(state.notes);
    this.shown = state;
    const before = this.current;
    const hadFocus = hasFocus(before?.dom);
    this.current = this.showOpen(state);
    this.listenOutside(state.open !== null);
    if (before === this.current) return;
    before?.dom.remove();
    // the open note went (resolved here or elsewhere): the focus must not get lost
    if (hadFocus) this.view.focus();
  }

  dispose(): void {
    this.resize?.disconnect();
    this.listenOutside(false);
    this.current?.dom.remove();
    this.onDispose();
  }

  private state(): CardsState {
    return cardsKey.getState(this.view.state)!;
  }

  private note(key: string): KeyedNote | undefined {
    return this.state().notes.find((note) => note.key === key);
  }

  /** Drops the cards (and drafts) of notes that are gone. */
  private forgetGone(notes: readonly KeyedNote[]): void {
    const keys = new Set(notes.map((note) => note.key));
    for (const key of this.cards.keys()) if (!keys.has(key)) this.cards.delete(key);
  }

  /** Shows the open note's card at its marker; undefined when no card is open. */
  private showOpen(state: CardsState): NoteCard | undefined {
    const note = state.open === null ? undefined : this.note(state.open);
    if (!note) return undefined;
    const card = this.card(note);
    card.show(note);
    if (!card.dom.isConnected) this.container.append(card.dom);
    this.place(card);
    return card;
  }

  private card(note: KeyedNote): NoteCard {
    let card = this.cards.get(note.key);
    if (!card) {
      card = new NoteCard(this.container.ownerDocument, note.key, this.me, this.cardActions);
      this.cards.set(note.key, card);
    }
    return card;
  }

  /** Below the open note's marker, inside the text column. */
  private place(card = this.current): void {
    const key = this.state().open;
    const marker = key === null ? null : this.view.dom.querySelector(`.${MARKER}[data-note-key="${key}"]`);
    if (!card || !marker) return;
    const box = this.container.getBoundingClientRect();
    const anchor = marker.getBoundingClientRect();
    const maxLeft = Math.max(0, this.container.clientWidth - card.dom.offsetWidth);
    card.dom.style.left = `${Math.round(Math.min(Math.max(anchor.left - box.left - CARD_INDENT_PX, 0), maxLeft))}px`;
    card.dom.style.top = `${Math.round(anchor.bottom - box.top + CARD_GAP_PX)}px`;
  }

  private listenOutside(on: boolean): void {
    const doc = this.container.ownerDocument;
    doc.removeEventListener('mousedown', this.pressed, true);
    if (on) doc.addEventListener('mousedown', this.pressed, true);
  }

  /** A press outside the card closes it, except on a marker (that opens its own) or the open note's own text. */
  private readonly pressed = (event: MouseEvent): void => {
    const open = this.current;
    const path = event.composedPath();
    if (!open || path.includes(open.dom)) return;
    const anchor = path.find((target): target is Element => target instanceof Element && target.hasAttribute('data-note-key'));
    if (anchor?.classList.contains(MARKER) || anchor?.getAttribute('data-note-key') === this.state().open) return;
    this.close(false);
  };

  private readonly cardActions: CardActions = {
    reply: (key, text) => this.rewrite(key, (note) => addReply(note, { author: this.me(), date: localDate(), text })),
    edit: (key, index, text) => this.rewrite(key, (note) => editMessage(note, index, text)),
    deleteMessage: (key, index) => {
      const note = this.note(key);
      if (note && deleteMessage(note.note, index) === '') this.cardActions.remove(key);
      else this.rewrite(key, (markup) => deleteMessage(markup, index));
    },
    remove: (key) => {
      const note = this.note(key);
      this.change(key, (tr, found) => removeNote(tr, found));
      if (note) this.returnTo({ ...note, to: note.from });
    },
    close: () => this.close(true),
  };

  /** Replaces the note's markup with `next(markup)` (one step), unless null, unchanged or unsafe for the call. */
  private rewrite(key: string, next: (markup: string) => string | null): void {
    this.change(key, (tr, note) => {
      const markup = next(note.note);
      const safe = markup === null ? null : safeNote(markup);
      return safe === null || safe !== markup || safe === note.note ? null : setNoteText(tr, note, safe);
    });
  }

  private change(key: string, edit: (tr: Transaction, note: KeyedNote) => Transaction | null): void {
    const note = this.note(key);
    const tr = note ? edit(this.view.state.tr, note) : null;
    if (tr) this.view.dispatch(tr);
  }

  /** Focuses the text: the cursor stays where it is when it is at `note`, else it goes after the note. */
  private returnTo(note: Pick<KeyedNote, 'key' | 'to'>): void {
    const { view } = this;
    if (noteNear(this.state().notes, view.state.selection)?.key !== note.key) {
      const { doc } = view.state;
      view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(Math.min(note.to, doc.content.size)))));
    }
    view.focus();
  }
}

/** Whether the focus is in `element`. */
function hasFocus(element: HTMLElement | undefined): boolean {
  return !!element && element.contains((element.getRootNode() as Document | ShadowRoot).activeElement);
}

/** The class of a note's marker (a point note's node view, or the widget after a range note's text). */
const MARKER = 'typst-comments__note';

/** The card's left edge is this far left of its marker, so its speech-bubble icon sits below the marker. */
const CARD_INDENT_PX = 8;
const CARD_GAP_PX = 4;

// ------------------------------------------------------------------ plugin

interface CardsState {
  notes: KeyedNote[];
  /** The key of the note whose card is open, if any. */
  open: string | null;
  decorations: DecorationSet;
}

/** A transaction's meta (`cardsKey`): opens the card of note `open`, or closes the open one (null). */
interface CardsMeta {
  open: string | null;
}

const cardsKey = new PluginKey<CardsState>('typst-comments__cards');

function cardsPlugin(createPopover: (view: EditorView) => NoteCardPopover): Plugin<CardsState> {
  let next = 0;
  const newKey = () => `n${next++}`;
  let popover: NoteCardPopover | null = null;
  return new Plugin<CardsState>({
    key: cardsKey,
    state: {
      init: (_config, state) => withDecorations(state, followNotes([], { map: (pos) => pos }, findNotes(state.doc), newKey), null),
      apply: (tr, previous, _old, state) => nextState(tr, previous, state, { newKey, cardFocused: () => popover?.focused() ?? false }),
    },
    props: {
      decorations: (state) => cardsKey.getState(state)?.decorations,
      handleDOMEvents: {
        mousedown: (_view, event) => {
          // a marker has no text to click into: it opens the card
          const key = (event.target as Element).closest?.(`.${MARKER}`)?.getAttribute('data-note-key');
          if (!key || !popover) return false;
          event.preventDefault();
          popover.open(key, true);
          return true;
        },
      },
      handleClick: (view, pos) => {
        // a click into highlighted text shows its note, the focus stays in the text
        const caret = TextSelection.near(view.state.doc.resolve(pos));
        const note = noteNear(cardsKey.getState(view.state)!.notes, caret);
        if (note?.kind !== 'range' || !popover) return false;
        // the caret first: ProseMirror reads a click's caret from the DOM only after this, and opening the card
        // (a transaction) would draw the caret from before the click back over it
        view.dispatch(view.state.tr.setSelection(caret));
        popover.open(note.key, false);
        return false;
      },
      handleKeyDown: (view, event) => {
        if (!popover) return false;
        if (event.key === 'Escape' && cardsKey.getState(view.state)!.open !== null) {
          popover.close(true);
          return true;
        }
        const note = event.key === 'Enter' && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
          ? noteNear(cardsKey.getState(view.state)!.notes, view.state.selection)
          : undefined;
        if (!note) return false;
        popover.open(note.key, true);
        return true;
      },
    },
    view: (view) => {
      popover = createPopover(view);
      const own = popover;
      return {
        update: () => own.update(),
        destroy: () => {
          own.dispose();
          if (popover === own) popover = null;
        },
      };
    },
  });
}

function nextState(tr: Transaction, previous: CardsState, state: EditorState, hooks: StateHooks): CardsState {
  const notes = tr.docChanged ? followNotes(previous.notes, tr.mapping, findNotes(tr.doc), hooks.newKey) : previous.notes;
  const open = openAfter(tr, previous.open, notes, hooks);
  if (notes === previous.notes && open === previous.open) return previous;
  return withDecorations(state, notes, open);
}

interface StateHooks {
  /** A key for a note found new. */
  newKey(): string;
  /** Whether the focus is in the open card. */
  cardFocused(): boolean;
}

/** The note whose card is open after `tr`: as asked (`CardsMeta`), else the one before while it exists. */
function openAfter(tr: Transaction, open: string | null, notes: readonly KeyedNote[], hooks: StateHooks): string | null {
  const meta: CardsMeta | undefined = tr.getMeta(cardsKey);
  const next = meta ? meta.open : open;
  if (next === null || !notes.some((note) => note.key === next)) return null;
  // a card opened from its text closes when the caret leaves the note
  const left = !meta && tr.selectionSet && !hooks.cardFocused() && noteNear(notes, tr.selection)?.key !== next;
  return left ? null : next;
}

/** The note at the selection: a selected point note, one right beside the caret, or the innermost range note around it. */
function noteNear<T extends KeyedNote>(notes: readonly T[], selection: Selection): T | undefined {
  const found = noteAtSelection(notes, selection);
  if (found || selection instanceof NodeSelection || !selection.empty) return found;
  const { head } = selection;
  return notes.find((note) => note.kind === 'point' && (note.from === head || note.to === head));
}

/**
 * The anchors (`data-note-key` on every note's marker and highlighted text, the open one's marked active, the first
 * message as tooltip) and a marker after every range note's text.
 */
function withDecorations(state: EditorState, notes: KeyedNote[], open: string | null): CardsState {
  const decorations = notes.flatMap((found) => {
    const { key, kind, from, to } = found;
    const title = summary(found.note);
    const attrs = { 'data-note-key': key, class: `typst-comments__anchor${key === open ? ' typst-comments__anchor--active' : ''}`, title };
    if (kind === 'point') return [Decoration.node(from, to, attrs)];
    const marker = Decoration.widget(to, (view) => rangeMarker(view.dom.ownerDocument, found, title, key === open), {
      key: `${key}|${key === open}|${title}`,
      side: -1,
      ignoreSelection: true,
    });
    return [Decoration.inline(from, to, attrs), marker];
  });
  return { notes, open, decorations: DecorationSet.create(state.doc, decorations) };
}

/** A note's tooltip: who wrote the first message, and its first words. */
function summary(note: string): string {
  const [first] = readThread(note);
  if (!first) return 'Empty comment';
  const words = firstWords(first.text, SUMMARY_LENGTH);
  return first.author ? `${first.author}: ${words}` : words;
}

const SUMMARY_LENGTH = 60;

/** The speech bubble after a range note's text. */
function rangeMarker(doc: Document, { key, note }: KeyedNote, title: string, open: boolean): HTMLElement {
  const marker = doc.createElement('span');
  const empty = note.trim() === '';
  marker.className = `${MARKER} typst-comments__anchor${open ? ' typst-comments__anchor--active' : ''}${empty ? ' typst-comments__note--empty' : ''}`;
  marker.contentEditable = 'false';
  marker.dataset.noteKey = key;
  marker.dataset.testid = 'typst-note-marker';
  marker.title = title;
  marker.setAttribute('role', 'button');
  marker.setAttribute('aria-haspopup', 'dialog');
  marker.setAttribute('aria-label', `Comment: ${title}`);
  marker.innerHTML = NOTE_ICON;
  return marker;
}
