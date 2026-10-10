import type { Comment, Thread } from './comments';

export interface PanelState {
  threads: readonly Thread[];
  /** The selected thread, which shows its reply box. */
  active: string | null;
  /** Whether a new comment is being written. */
  draft: boolean;
}

export interface PanelActions {
  select(threadId: string): void;
  submitDraft(text: string): void;
  cancelDraft(): void;
  reply(threadId: string, text: string): void;
  setResolved(threadId: string, resolved: boolean): void;
  remove(threadId: string): void;
}

const DRAFT = '';
const ICONS = {
  resolve: '<path d="M3.5 8.5l3 3 6-7"/>',
  reopen: '<path d="M3 8a5 5 0 1 0 1.5-3.5M3 2.5V5h2.5"/>',
  remove: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5"/>',
};

/**
 * The comments side panel: a card per thread (quoted text, messages with
 * author and time, reply box when selected, resolve/reopen and delete) and
 * a card for a new comment. Renders whatever state it is given and reports
 * user intent through `actions`; text typed into a box survives re-renders.
 */
export class CommentsPanel {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private readonly texts = new Map<string, string>();
  private readonly dates = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  private state: PanelState = { threads: [], active: null, draft: false };

  constructor(
    private readonly doc: Document,
    private readonly actions: PanelActions,
  ) {
    this.element = this.el('aside', 'typst-comments');
    this.element.setAttribute('aria-label', 'Comments');
    this.element.dataset.testid = 'typst-comments';
    const header = this.el('header', 'typst-comments__header', 'Comments');
    this.list = this.el('div', 'typst-comments__list');
    this.element.append(header, this.list);
    this.element.addEventListener('click', (event) => this.handleClick(event));
    this.element.addEventListener('keydown', (event) => this.handleKey(event));
    this.element.addEventListener('input', (event) => {
      const box = event.target as HTMLTextAreaElement;
      this.texts.set(box.dataset.key ?? DRAFT, box.value);
      this.syncSubmit(box);
    });
  }

  render(state: PanelState): void {
    // In a shadow root, only the root knows which element inside has focus.
    const active = (this.element.getRootNode() as Document | ShadowRoot).activeElement as HTMLElement | null;
    const focused = active?.tagName === 'TEXTAREA' && this.list.contains(active) ? (active.dataset.key ?? null) : null;
    this.state = state;
    if (!state.draft) this.texts.delete(DRAFT);
    const cards = state.threads.map((thread) => this.threadCard(thread));
    if (state.draft) cards.unshift(this.draftCard());
    this.list.replaceChildren(...cards);
    if (focused !== null) this.focusBox(focused);
  }

  /** Puts the cursor into the new-comment box. */
  focusDraft(): void {
    this.focusBox(DRAFT);
  }

  /** Scrolls the panel (only the panel) so the card of `threadId` is visible. */
  reveal(threadId: string): void {
    const card = [...this.list.querySelectorAll<HTMLElement>('[data-thread-id]')].find((c) => c.dataset.threadId === threadId);
    if (!card) return;
    const top = card.offsetTop - this.list.offsetTop;
    if (top < this.list.scrollTop || top + card.offsetHeight > this.list.scrollTop + this.list.clientHeight) {
      this.list.scrollTop = top - 8;
    }
  }

  private draftCard(): HTMLElement {
    const card = this.el('article', 'typst-comment typst-comment--draft typst-comment--active');
    card.append(this.el('div', 'typst-comment__new', 'New comment'), this.editor(DRAFT, 'Add a comment…', 'Comment'));
    return card;
  }

  private threadCard(thread: Thread): HTMLElement {
    const card = this.el('article', 'typst-comment');
    card.dataset.threadId = thread.id;
    card.classList.toggle('typst-comment--active', thread.id === this.state.active);
    card.classList.toggle('typst-comment--resolved', thread.resolved);
    card.classList.toggle('typst-comment--orphan', !thread.range);
    card.append(this.cardHeader(thread), ...thread.comments.map((comment) => this.message(comment)));
    if (thread.id === this.state.active && !thread.resolved) card.append(this.editor(thread.id, 'Reply…', 'Reply'));
    return card;
  }

  private cardHeader(thread: Thread): HTMLElement {
    const header = this.el('div', 'typst-comment__header');
    const quote = this.el('blockquote', 'typst-comment__quote', thread.quote);
    quote.title = thread.quote;
    const status = thread.range ? (thread.resolved ? 'Resolved' : null) : 'Text deleted';
    const actions = this.el('div', 'typst-comment__actions');
    actions.append(
      thread.resolved ? this.iconButton('reopen', 'Reopen') : this.iconButton('resolve', 'Resolve'),
      this.iconButton('remove', 'Delete thread'),
    );
    header.append(quote);
    if (status) header.append(this.el('span', 'typst-comment__status', status));
    header.append(actions);
    return header;
  }

  private message(comment: Comment): HTMLElement {
    const entry = this.el('div', 'typst-comment__message');
    const time = this.el('time', 'typst-comment__time', this.formatTime(comment.time));
    time.setAttribute('datetime', comment.time);
    const meta = this.el('div', 'typst-comment__meta');
    meta.append(this.el('span', 'typst-comment__author', comment.author), time);
    entry.append(this.avatar(comment.author), meta, this.el('p', 'typst-comment__text', comment.text));
    return entry;
  }

  private avatar(name: string): HTMLElement {
    const avatar = this.el('span', 'typst-comment__avatar', [...name.trim()][0]?.toUpperCase() ?? '?');
    avatar.style.setProperty('--hue', String(hue(name)));
    avatar.setAttribute('aria-hidden', 'true');
    return avatar;
  }

  /** A text box with submit (and, for a new comment, cancel). Mod-Enter submits, Escape cancels. */
  private editor(key: string, placeholder: string, submit: string): HTMLElement {
    const form = this.el('div', 'typst-comment__form');
    const box = this.el('textarea', 'typst-comment__input') as HTMLTextAreaElement;
    box.dataset.key = key;
    box.placeholder = placeholder;
    box.rows = 2;
    box.value = this.texts.get(key) ?? '';
    box.setAttribute('aria-label', placeholder.replace('…', ''));
    const buttons = this.el('div', 'typst-comment__buttons');
    if (key === DRAFT) buttons.append(this.button('cancel', 'Cancel', 'typst-comment__button'));
    buttons.append(this.button('submit', submit, 'typst-comment__button typst-comment__button--primary'));
    form.append(box, buttons);
    this.syncSubmit(box, buttons);
    return form;
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>('.typst-comment');
    const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action) {
      this.run(action, card);
    } else if (card?.dataset.threadId && !target.closest('textarea')) {
      this.actions.select(card.dataset.threadId);
    }
  }

  private handleKey(event: KeyboardEvent): void {
    const box = event.target as HTMLElement;
    if (box.tagName !== 'TEXTAREA') return;
    const card = box.closest<HTMLElement>('.typst-comment');
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.run('submit', card);
    } else if (event.key === 'Escape' && box.dataset.key === DRAFT) {
      event.preventDefault();
      this.run('cancel', card);
    }
  }

  private run(action: string, card: HTMLElement | null): void {
    const id = card?.dataset.threadId;
    if (action === 'cancel') return this.actions.cancelDraft();
    if (action === 'submit') return this.submit(id ?? DRAFT);
    if (!id) return;
    if (action === 'remove') this.actions.remove(id);
    else this.actions.setResolved(id, action === 'resolve');
  }

  private submit(key: string): void {
    const text = (this.texts.get(key) ?? '').trim();
    if (!text) return;
    this.texts.delete(key);
    if (key === DRAFT) this.actions.submitDraft(text);
    else this.actions.reply(key, text);
  }

  private syncSubmit(box: HTMLTextAreaElement, form: HTMLElement | null = box.parentElement): void {
    const submit = form?.querySelector<HTMLButtonElement>('[data-action="submit"]');
    if (submit) submit.disabled = box.value.trim() === '';
  }

  private focusBox(key: string): void {
    const box = [...this.list.querySelectorAll('textarea')].find((b) => b.dataset.key === key);
    box?.focus();
    box?.setSelectionRange(box.value.length, box.value.length);
  }

  private formatTime(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : this.dates.format(date);
  }

  private iconButton(action: keyof typeof ICONS, label: string): HTMLElement {
    const button = this.button(action, '', 'typst-comment__icon');
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[action]}</svg>`;
    return button;
  }

  private button(action: string, text: string, className: string): HTMLButtonElement {
    const button = this.el('button', className, text) as HTMLButtonElement;
    button.type = 'button';
    button.dataset.action = action;
    return button;
  }

  private el(tag: string, className: string, text?: string): HTMLElement {
    const element = this.doc.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
}

/** A stable avatar colour per author name. */
function hue(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}
