// See WindowApi in ../window.ts.
import type { MessageItem, MessageOptions, MessageSeverity } from '../window';

/**
 * The widget's notification area (`showInformationMessage`, `showWarningMessage`, `showErrorMessage`): each message
 * is a small box with its text, a button per item and a close button, stacked at the bottom right, newest last. Not
 * modal; nothing takes the focus. Information is `role=status` (read out politely) and closes by itself after a while
 * unless it has items or the pointer or focus is on it; warnings and errors are `role=alert` and stay until closed.
 *
 * A modal message (`options.modal`) is a card in the middle of an overlay over the whole widget (`role=alertdialog`),
 * its `detail` below the text, a button per item, the first one focused; it has no close button and closes only when an
 * item is chosen (or the widget goes).
 *
 * @internal Extensions use it through `window.showInformationMessage`, `showWarningMessage` and `showErrorMessage`.
 */
export class Notifications {
  readonly #area: HTMLElement;
  readonly #shown: Shown[] = [];
  readonly #modals: Shown[] = [];

  constructor(host: HTMLElement) {
    this.#area = host.ownerDocument.createElement('div');
    this.#area.className = 'zwf-editor__notifications';
    this.#area.dataset.testid = 'zwf-notifications';
    host.append(this.#area);
  }

  /** Shows `message`; resolves to the item chosen, or undefined once it is closed otherwise. */
  show<T extends string | MessageItem>(severity: MessageSeverity, message: string, items: readonly T[], options: MessageOptions = {}): Promise<T | undefined> {
    if (options.modal) return this.#showModal(severity, message, items, options.detail);
    return new Promise((resolve) => {
      const doc = this.#area.ownerDocument;
      const element = doc.createElement('div');
      element.className = `zwf-notification zwf-notification--${severity}`;
      element.setAttribute('role', severity === 'info' ? 'status' : 'alert');
      const text = doc.createElement('span');
      text.className = 'zwf-notification__message';
      text.textContent = message;
      const actions = doc.createElement('span');
      actions.className = 'zwf-notification__actions';
      let timer: ReturnType<typeof setTimeout> | undefined;
      const shown: Shown = { element, close: () => finish(undefined) };
      const finish = (item: T | undefined) => {
        clearTimeout(timer);
        const at = this.#shown.indexOf(shown);
        if (at < 0) return;
        this.#shown.splice(at, 1);
        element.remove();
        resolve(item);
      };
      for (const item of items) actions.append(button(doc, typeof item === 'string' ? item : item.title, 'zwf-notification__item', () => finish(item)));
      const close = button(doc, '×', 'zwf-notification__close', () => finish(undefined));
      close.setAttribute('aria-label', 'Close');
      close.title = 'Close';
      element.append(text, actions, close);
      if (severity === 'info' && items.length === 0) {
        const start = () => (timer = setTimeout(() => finish(undefined), INFO_TIMEOUT_MS));
        const stop = () => clearTimeout(timer);
        for (const type of ['pointerenter', 'focusin']) element.addEventListener(type, stop);
        element.addEventListener('pointerleave', () => !element.matches(':focus-within') && start());
        element.addEventListener('focusout', (event) => !element.contains(event.relatedTarget as Node | null) && start());
        start();
      }
      this.#shown.push(shown);
      this.#area.append(element);
      while (this.#shown.length > MAX_SHOWN) this.#shown[0].close();
    });
  }

  /** Closes every message (resolving them to undefined) and removes the area. */
  dispose(): void {
    for (const shown of [...this.#shown, ...this.#modals]) shown.close();
    this.#area.remove();
  }

  #showModal<T extends string | MessageItem>(severity: MessageSeverity, message: string, items: readonly T[], detail: string | undefined): Promise<T | undefined> {
    return new Promise((resolve) => {
      const doc = this.#area.ownerDocument;
      const overlay = doc.createElement('div');
      overlay.className = 'zwf-editor__modal';
      overlay.dataset.testid = 'zwf-modal';
      const card = overlay.appendChild(doc.createElement('div'));
      card.className = `zwf-modal zwf-modal--${severity}`;
      card.setAttribute('role', 'alertdialog');
      card.setAttribute('aria-modal', 'true');
      card.setAttribute('aria-label', message);
      const title = card.appendChild(doc.createElement('h2'));
      title.className = 'zwf-modal__message';
      title.textContent = message;
      if (detail) {
        const text = card.appendChild(doc.createElement('p'));
        text.className = 'zwf-modal__detail';
        text.textContent = detail;
        card.setAttribute('aria-description', detail);
      }
      const actions = card.appendChild(doc.createElement('div'));
      actions.className = 'zwf-modal__actions';
      const shown: Shown = { element: overlay, close: () => finish(undefined) };
      const finish = (item: T | undefined) => {
        const at = this.#modals.indexOf(shown);
        if (at < 0) return;
        this.#modals.splice(at, 1);
        overlay.remove();
        resolve(item);
      };
      for (const item of items) actions.append(button(doc, typeof item === 'string' ? item : item.title, 'zwf-modal__item', () => finish(item)));
      this.#modals.push(shown);
      this.#area.before(overlay);
      actions.querySelector('button')?.focus();
    });
  }
}

interface Shown {
  element: HTMLElement;
  close(): void;
}

function button(doc: Document, text: string, className: string, onClick: () => void): HTMLButtonElement {
  const element = doc.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = text;
  element.addEventListener('click', onClick);
  return element;
}

/** How long an information message without items stays. */
const INFO_TIMEOUT_MS = 8000;
/** At most this many messages show at once; a new one closes the oldest. */
const MAX_SHOWN = 3;
