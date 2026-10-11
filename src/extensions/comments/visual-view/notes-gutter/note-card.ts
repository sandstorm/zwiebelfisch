// NoteCard: one margin note's card in the notes gutter: its thread, a reply box, editing own messages. See notes-gutter.ts.
import { readThread, type NoteMessage } from '../../model/note-thread';
import type { KeyedNote } from './note-list';

/** What a card asks the gutter to do with its note (nothing happens if the note is gone). */
export interface CardActions {
  /** Appends `text` as a message of the current user. */
  reply(key: string, text: string): void;
  /** Replaces the text of message `index`. */
  edit(key: string, index: number, text: string): void;
  /** Deletes message `index` (the whole note if it is the only one). */
  deleteMessage(key: string, index: number): void;
  /** Resolves the note: deletes it. */
  remove(key: string): void;
  /** Editing is over: the text cursor goes after the note. */
  done(key: string): void;
  activate(key: string): void;
  hover(key: string | null): void;
  resized(): void;
}

/** Threads longer than this show the first message, "n more" and the last two. */
const COLLAPSE_ABOVE = 4;
const SHOWN_AT_END = 2;

/**
 * One note's card: what it highlights, its thread (name, date and text per
 * message, oldest first, long threads collapsed), and a reply box (Mod+Enter
 * sends). Messages of the current user (`me`, by name: a soft rule) and
 * anonymous ones (no name) can be edited in place (pencil; Mod+Enter or leaving saves,
 * Escape cancels); the last message, if it is the user's, can be deleted.
 * "Resolve" deletes the note.
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

  constructor(doc: Document, private readonly key: string, private readonly me: string, private readonly actions: CardActions) {
    this.dom = doc.createElement('div');
    this.dom.className = 'typst-comments__card';
    this.dom.dataset.testid = 'typst-note-card';
    this.dom.dataset.noteKey = key;
    this.dom.innerHTML = CARD_HTML;
    this.quote = this.dom.querySelector('.typst-comments__card-quote')!;
    this.thread = this.dom.querySelector('.typst-comments__card-thread')!;
    this.field = this.dom.querySelector('.typst-comments__card-reply')!;
    // buttons must not take the focus from a field (resolving must not send a draft first)
    this.dom.addEventListener('mousedown', (event) => this.handleMouseDown(event));
    this.dom.addEventListener('click', (event) => this.handleClick(event));
    this.dom.addEventListener('mouseenter', () => actions.hover(key));
    this.dom.addEventListener('mouseleave', () => actions.hover(null));
    this.dom.addEventListener('focusin', () => actions.activate(key));
    this.field.addEventListener('input', () => actions.resized());
    this.field.addEventListener('keydown', (event) => this.handleReplyKey(event));
    this.field.addEventListener('blur', () => {
      // a note's first message is sent when the box is left (a reply waits for Mod+Enter)
      if (this.messages.length === 0) this.send();
    });
  }

  /** Shows `note`; the reply box and a message being edited keep what the user typed. */
  show(note: KeyedNote): void {
    this.dom.classList.toggle('typst-comments__card--range', note.kind === 'range');
    this.quote.textContent = note.kind === 'range' ? note.text : 'Note';
    this.quote.title = note.kind === 'range' ? note.text : '';
    if (note.note === this.markup) return;
    this.markup = note.note;
    this.messages = readThread(note.note);
    this.field.placeholder = this.messages.length === 0 ? 'Write a comment…' : 'Reply…';
    this.field.setAttribute('aria-label', this.messages.length === 0 ? 'Comment' : 'Reply');
    if (!this.editing) this.renderThread();
  }

  highlight(active: boolean, hover: boolean): void {
    this.dom.classList.toggle('typst-comments__card--active', active);
    this.dom.classList.toggle('typst-comments__card--hover', hover);
  }

  /** Focuses the reply box. */
  focus(): void {
    this.field.focus();
    this.field.setSelectionRange(this.field.value.length, this.field.value.length);
  }

  place(top: number): void {
    this.dom.style.top = `${Math.round(top)}px`;
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
      more.innerHTML = `<button type="button" class="typst-comments__card-more" data-action="more">${count - 1 - SHOWN_AT_END} more</button>`;
      items.splice(1, 0, more);
    }
    this.thread.replaceChildren(...items);
    this.thread.hidden = count === 0;
    this.actions.resized();
  }

  private messageItem(doc: Document, message: NoteMessage, index: number): HTMLElement {
    const item = doc.createElement('li');
    item.className = 'typst-comments__card-message';
    item.dataset.testid = 'typst-note-message';
    item.dataset.index = String(index);
    const meta = item.appendChild(doc.createElement('div'));
    meta.className = 'typst-comments__card-meta';
    if (message.author !== null) meta.append(span(doc, 'typst-comments__card-author', message.author));
    if (message.date !== null) meta.append(span(doc, 'typst-comments__card-date', message.date));
    const own = message.author === this.me;
    if (own || message.author === null) meta.insertAdjacentHTML('beforeend', EDIT_BUTTON);
    if (own && index === this.messages.length - 1) meta.insertAdjacentHTML('beforeend', DELETE_BUTTON);
    item.append(span(doc, 'typst-comments__card-text', message.text));
    return item;
  }

  private handleMouseDown(event: MouseEvent): void {
    const target = event.target as Element;
    if (target.closest('button')) {
      event.preventDefault();
    } else if (!target.closest('textarea, .typst-comments__card-thread')) {
      // a click on the card's head or margins goes to the reply box
      event.preventDefault();
      this.focus();
    }
  }

  /** The buttons, by `data-action`; `index` is the message's (NaN outside a message). */
  private readonly buttonActions: Record<string, (index: number) => void> = {
    resolve: () => this.actions.remove(this.key),
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

  private handleReplyKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      this.send();
    } else if (event.key === 'Escape') {
      this.field.value = '';
    } else {
      return;
    }
    event.preventDefault();
    this.actions.done(this.key);
  }

  /** Replaces message `index`'s text with a text area holding it. */
  private startEdit(index: number): void {
    const item = this.thread.querySelector<HTMLElement>(`[data-index="${index}"]`);
    const text = item?.querySelector('.typst-comments__card-text');
    if (!item || !text || this.editing) return;
    const field = this.dom.ownerDocument.createElement('textarea');
    field.className = 'typst-comments__card-field';
    field.rows = 2;
    field.setAttribute('aria-label', 'Edit message');
    field.value = this.messages[index].text;
    text.replaceWith(field);
    this.editing = { index, field };
    field.addEventListener('input', () => this.actions.resized());
    field.addEventListener('blur', () => this.finishEdit(true));
    field.addEventListener('keydown', (event) => {
      const save = event.key === 'Enter' && (event.metaKey || event.ctrlKey);
      if (!save && event.key !== 'Escape') return;
      event.preventDefault();
      this.finishEdit(save);
      this.actions.done(this.key);
    });
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
    this.actions.resized();
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

function span(doc: Document, className: string, text: string): HTMLElement {
  const element = doc.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

const ICON =
  '<svg class="typst-comments__card-icon" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z"/></svg>';
const CHECK =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>';
const PENCIL =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M3 13l.6-2.6L10.5 3.5l2 2-6.9 6.9z"/></svg>';
const TRASH =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>';
const SEND =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 8l11-5-4 11-2-4.5z"/></svg>';
const EDIT_BUTTON = `<button type="button" class="typst-comments__card-edit" data-action="edit" aria-label="Edit message" title="Edit">${PENCIL}</button>`;
const DELETE_BUTTON = `<button type="button" class="typst-comments__card-delete" data-action="delete" aria-label="Delete message" title="Delete">${TRASH}</button>`;
const CARD_HTML =
  `<div class="typst-comments__card-head">${ICON}<span class="typst-comments__card-quote"></span>`
  + `<button type="button" class="typst-comments__card-resolve" data-action="resolve" aria-label="Resolve note" title="Resolve: delete the note (Typst: removes the margin-note call)">${CHECK}</button></div>`
  + '<ol class="typst-comments__card-thread" hidden></ol>'
  + '<div class="typst-comments__card-compose"><textarea class="typst-comments__card-reply" rows="1" aria-label="Comment" placeholder="Write a comment…"></textarea>'
  + `<button type="button" class="typst-comments__card-send" data-action="send" aria-label="Send" title="Send (Ctrl+Enter)">${SEND}</button></div>`;
