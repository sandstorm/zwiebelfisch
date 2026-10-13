// One margin note's floating card. See NoteCardPopover in note-cards.ts.
import { readThread, type NoteMessage } from '../../model/note-thread';
import type { KeyedNote } from './note-list';

/**
 * One note's card, a `role="dialog"`: what it highlights, its thread (name,
 * date and text per message, oldest first, long threads collapsed), and a
 * reply box (Mod+Enter sends; the box keeps the focus). Messages of the
 * current user (`me`, by name: a soft rule) and anonymous ones (no name) can
 * be edited in place (pencil; Mod+Enter or leaving saves, Escape cancels); the
 * last message, if it is the user's, can be deleted. "Resolve" deletes the
 * note. Escape (outside a message being edited) and "Close" close the card;
 * Tab and Shift+Tab stay inside it.
 */
export class NoteCard {
  readonly dom: HTMLElement;
  private readonly quote: HTMLElement;
  private readonly thread: HTMLElement;
  private readonly field: HTMLTextAreaElement;
  private messages: NoteMessage[] = [];
  /** The note's markup as last shown. */
  private markup: string | null = null;
  private expanded = false;
  /** The message being edited, if any: its index and its text area. */
  private editing: { index: number; field: HTMLTextAreaElement } | null = null;

  constructor(doc: Document, private readonly key: string, private readonly me: () => string, private readonly actions: CardActions) {
    this.dom = doc.createElement('div');
    this.dom.className = 'zwf-comments__card';
    this.dom.dataset.testid = 'zwf-note-card';
    this.dom.dataset.noteKey = key;
    this.dom.setAttribute('role', 'dialog');
    this.dom.innerHTML = CARD_HTML;
    this.quote = this.dom.querySelector('.zwf-comments__card-quote')!;
    this.thread = this.dom.querySelector('.zwf-comments__card-thread')!;
    this.field = this.dom.querySelector('.zwf-comments__card-reply')!;
    // buttons must not take the focus from a field (resolving must not send a draft first)
    this.dom.addEventListener('mousedown', (event) => this.handleMouseDown(event));
    this.dom.addEventListener('click', (event) => this.handleClick(event));
    this.dom.addEventListener('keydown', (event) => this.handleKey(event));
    this.field.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      this.send();
    });
  }

  /** Shows `note`; the reply box and a message being edited keep what the user typed. */
  show(note: KeyedNote): void {
    this.dom.classList.toggle('zwf-comments__card--range', note.kind === 'range');
    this.quote.textContent = note.kind === 'range' ? note.text : 'Comment';
    this.quote.title = note.kind === 'range' ? note.text : '';
    this.dom.setAttribute('aria-label', note.kind === 'range' ? `Comment on “${note.text}”` : 'Comment');
    if (note.note === this.markup) return;
    this.markup = note.note;
    this.messages = readThread(note.note);
    this.field.placeholder = this.messages.length === 0 ? 'Write a comment…' : 'Reply…';
    this.field.setAttribute('aria-label', this.messages.length === 0 ? 'Comment' : 'Reply');
    if (!this.editing) this.renderThread();
  }

  /** Focuses the reply box. */
  focus(): void {
    this.field.focus();
    this.field.setSelectionRange(this.field.value.length, this.field.value.length);
  }

  /** Before the card closes: saves a message being edited, and sends a new note's first message (the reply box keeps a reply). */
  commit(): void {
    this.finishEdit(true);
    if (this.messages.length === 0) this.send();
  }

  private renderThread(): void {
    const doc = this.dom.ownerDocument;
    const count = this.messages.length;
    const collapsed = !this.expanded && count > COLLAPSE_ABOVE;
    const shown = this.messages.map((message, index) => ({ message, index }))
      .filter(({ index }) => !collapsed || index === 0 || index >= count - SHOWN_AT_END);
    const items = shown.map(({ message, index }) => this.messageItem(doc, message, index));
    if (collapsed) {
      const more = doc.createElement('li');
      more.innerHTML = `<button type="button" class="zwf-comments__card-more" data-action="more">${count - 1 - SHOWN_AT_END} more</button>`;
      items.splice(1, 0, more);
    }
    this.thread.replaceChildren(...items);
    this.thread.hidden = count === 0;
  }

  private messageItem(doc: Document, message: NoteMessage, index: number): HTMLElement {
    const item = doc.createElement('li');
    item.className = 'zwf-comments__card-message';
    item.dataset.testid = 'zwf-note-message';
    item.dataset.index = String(index);
    const meta = item.appendChild(doc.createElement('div'));
    meta.className = 'zwf-comments__card-meta';
    if (message.author !== null) meta.append(span(doc, 'zwf-comments__card-author', message.author));
    if (message.date !== null) meta.append(span(doc, 'zwf-comments__card-date', message.date));
    const own = message.author === this.me();
    if (own || message.author === null) meta.insertAdjacentHTML('beforeend', EDIT_BUTTON);
    if (own && index === this.messages.length - 1) meta.insertAdjacentHTML('beforeend', DELETE_BUTTON);
    item.append(span(doc, 'zwf-comments__card-text', message.text));
    return item;
  }

  private handleMouseDown(event: MouseEvent): void {
    const target = event.target as Element;
    if (target.closest('button')) {
      event.preventDefault();
    } else if (!target.closest('textarea, .zwf-comments__card-thread')) {
      // a click on the card's head or margins goes to the reply box
      event.preventDefault();
      this.focus();
    }
  }

  /** The buttons, by `data-action`; `index` is the message's (NaN outside a message). */
  private readonly buttonActions: Record<string, (index: number) => void> = {
    resolve: () => this.actions.remove(this.key),
    close: () => this.actions.close(this.key),
    more: () => this.expand(),
    send: () => this.send(),
    edit: (index) => this.startEdit(index),
    delete: (index) => this.actions.deleteMessage(this.key, index),
  };

  private handleClick(event: MouseEvent): void {
    const button = (event.target as Element).closest<HTMLElement>('button[data-action]');
    const index = Number(button?.closest<HTMLElement>('[data-index]')?.dataset.index);
    if (button) this.buttonActions[button.dataset.action!]?.(index);
  }

  /** Escape closes the card; Tab and Shift+Tab go round its fields and buttons. */
  private handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.actions.close(this.key);
    } else if (event.key === 'Tab') {
      const stops = [...this.dom.querySelectorAll<HTMLElement>('button, textarea')].filter((element) => !element.closest('[hidden]'));
      const active = (this.dom.getRootNode() as Document | ShadowRoot).activeElement;
      const next = event.shiftKey ? (active === stops[0] ? stops.at(-1) : null) : (active === stops.at(-1) ? stops[0] : null);
      if (!next) return;
      event.preventDefault();
      next.focus();
    }
  }

  private expand(): void {
    this.expanded = true;
    this.renderThread();
  }

  /** Sends the reply box's text (nothing if empty) and empties it. */
  private send(): void {
    const text = this.field.value;
    if (text.trim() === '') return;
    this.field.value = '';
    this.actions.reply(this.key, text);
  }

  /** Replaces message `index`'s text with a text area holding it. */
  private startEdit(index: number): void {
    const item = this.thread.querySelector<HTMLElement>(`[data-index="${index}"]`);
    const text = item?.querySelector('.zwf-comments__card-text');
    if (!item || !text || this.editing) return;
    const field = this.dom.ownerDocument.createElement('textarea');
    field.className = 'zwf-comments__card-field';
    field.rows = 2;
    field.setAttribute('aria-label', 'Edit message');
    field.value = this.messages[index].text;
    text.replaceWith(field);
    this.editing = { index, field };
    field.addEventListener('blur', () => this.finishEdit(true));
    field.addEventListener('keydown', (event) => {
      const save = event.key === 'Enter' && (event.metaKey || event.ctrlKey);
      if (!save && event.key !== 'Escape') return;
      // Escape ends the edit, not the card
      event.preventDefault();
      event.stopPropagation();
      this.finishEdit(save);
      this.focus();
    });
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }

  private finishEdit(save: boolean): void {
    const editing = this.editing;
    if (!editing) return;
    this.editing = null;
    const { index, field } = editing;
    if (save && field.value !== this.messages[index]?.text) this.actions.edit(this.key, index, field.value);
    this.renderThread();
  }
}

/** What a card asks for its note (nothing happens if the note is gone). */
export interface CardActions {
  /** Appends `text` as a message of the current user. */
  reply(key: string, text: string): void;
  /** Replaces the text of message `index`. */
  edit(key: string, index: number, text: string): void;
  /** Deletes message `index` (the whole note if it is the only one). */
  deleteMessage(key: string, index: number): void;
  /** Resolves the note: deletes it. */
  remove(key: string): void;
  /** Closes the card; the focus goes back to the text. */
  close(key: string): void;
}

const ICON =
  '<svg class="zwf-comments__card-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>';
const CHECK =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>';
const CROSS =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

const SEND =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 8l11-5-4 11-2-4.5z"/></svg>';

const CARD_HTML =
  `<div class="zwf-comments__card-head">${ICON}<span class="zwf-comments__card-quote"></span>`
  + `<button type="button" class="zwf-comments__card-resolve" data-action="resolve" aria-label="Resolve note" title="Resolve: delete the note (Typst: removes the margin-note call)">${CHECK}</button>`
  + `<button type="button" class="zwf-comments__card-close" data-action="close" aria-label="Close" title="Close (Escape)">${CROSS}</button></div>`
  + '<ol class="zwf-comments__card-thread" hidden></ol>'
  + '<div class="zwf-comments__card-compose"><textarea class="zwf-comments__card-reply" rows="1" aria-label="Comment" placeholder="Write a comment…"></textarea>'
  + `<button type="button" class="zwf-comments__card-send" data-action="send" aria-label="Send" title="Send (Ctrl+Enter)">${SEND}</button></div>`;

/** Threads longer than this show the first message, "n more" and the last two. */
const COLLAPSE_ABOVE = 4;
const SHOWN_AT_END = 2;

function span(doc: Document, className: string, text: string): HTMLElement {
  const element = doc.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

const PENCIL =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3 13l.6-2.6L10.5 3.5l2 2-6.9 6.9z"/></svg>';

const EDIT_BUTTON = `<button type="button" class="zwf-comments__card-edit" data-action="edit" aria-label="Edit message" title="Edit">${PENCIL}</button>`;

const TRASH =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>';

const DELETE_BUTTON = `<button type="button" class="zwf-comments__card-delete" data-action="delete" aria-label="Delete message" title="Delete">${TRASH}</button>`;
