// QuickInput: what `showInputBox` and `showQuickPick` show: a small box over the widget, below what the user just
// used. See window.ts.
import type { InputBoxOptions, QuickPickItem, QuickPickOptions } from '../window';

/** Elements taller than this (an editor's whole text) are no anchor: the box goes to their top instead. */
const MAX_ANCHOR_HEIGHT = 120;
/** Between the anchor and the box. */
const GAP = 4;

/** A box on screen: closing it removes it and gives the focus back. */
interface Open {
  readonly box: HTMLElement;
  cancel(): void;
}

let ids = 0;

/**
 * One box at a time over the widget `host` (a new one cancels the open one), placed below its anchor and kept inside
 * the widget (above the anchor where there is no room below): the anchor is what the user last pressed or typed in
 * (a button, a row), or, in an editor, the selection; without one, at the top in the middle (as VS Code's). Escape
 * or a mouse press elsewhere cancels; closing gives the focus back to where it was.
 */
export class QuickInput {
  #trigger: Element | null = null;
  #open: Open | null = null;

  constructor(private readonly host: HTMLElement) {
    host.addEventListener('pointerdown', this.#remember, true);
    host.addEventListener('keydown', this.#remember, true);
  }

  showInputBox(options: InputBoxOptions = {}): Promise<string | undefined> {
    return new Promise((resolve) => {
      const doc = this.host.ownerDocument;
      const form = element(doc, 'form', 'typst-quick-input');
      form.setAttribute('aria-label', options.title ?? options.prompt ?? 'Input');
      const input = element(doc, 'input', 'typst-quick-input__field');
      input.type = 'text';
      input.value = options.value ?? '';
      input.placeholder = options.placeHolder ?? '';
      input.setAttribute('aria-label', options.prompt ?? options.title ?? 'Input');
      const ok = element(doc, 'button', 'typst-quick-input__ok');
      ok.type = 'submit';
      ok.textContent = 'OK';
      const row = element(doc, 'div', 'typst-quick-input__row');
      row.append(input, ok);
      const message = element(doc, 'div', 'typst-quick-input__message');
      message.setAttribute('role', 'alert');
      form.append(...title(doc, options.title), row);
      if (options.prompt) {
        const prompt = element(doc, 'div', 'typst-quick-input__prompt');
        prompt.textContent = options.prompt;
        prompt.setAttribute('aria-hidden', 'true'); // the field's name already
        form.append(prompt);
      }
      form.append(message);
      // only the latest check counts (they may be async)
      let checks = 0;
      const validate = async (value: string): Promise<string> => {
        const check = ++checks;
        const problem = (await options.validateInput?.(value)) || '';
        if (check === checks) message.textContent = problem;
        return problem;
      };
      input.addEventListener('input', () => void validate(input.value));
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const value = input.value;
        const problem = await validate(value);
        if (!problem && input.value === value) close(value);
      });
      const close = this.#present(form, input, resolve);
      const [start, end] = options.valueSelection ?? [0, input.value.length];
      input.setSelectionRange(start, end);
    });
  }

  showQuickPick<T extends string | QuickPickItem>(items: readonly T[] | Promise<readonly T[]>, options: QuickPickOptions & { canPickMany: true }): Promise<T[] | undefined>;
  showQuickPick<T extends string | QuickPickItem>(items: readonly T[] | Promise<readonly T[]>, options?: QuickPickOptions): Promise<T | undefined>;
  showQuickPick<T extends string | QuickPickItem>(items: readonly T[] | Promise<readonly T[]>, options: QuickPickOptions = {}): Promise<T | T[] | undefined> {
    // shown at once when the items are there (a test, or a caller, sees the box right after the call)
    return isArray(items) ? this.#pick(items, options) : items.then((list) => this.#pick(list, options));
  }

  #pick<T extends string | QuickPickItem>(list: readonly T[], options: QuickPickOptions): Promise<T | T[] | undefined> {
    return new Promise((resolve) => {
      const doc = this.host.ownerDocument;
      const box = element(doc, 'div', 'typst-quick-input typst-quick-pick');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', options.title ?? options.placeHolder ?? 'Pick');
      const filter = element(doc, 'input', 'typst-quick-input__field');
      filter.type = 'text';
      filter.placeholder = options.placeHolder ?? '';
      filter.setAttribute('aria-label', options.placeHolder ?? options.title ?? 'Filter');
      const listbox = element(doc, 'div', 'typst-quick-pick__list');
      box.append(...title(doc, options.title), filter, listbox);
      let picker: { filter(text: string): void; key(event: KeyboardEvent): void };
      if (options.canPickMany) {
        const many = new ManyPicker(doc, list, listbox, () => close(many.picked()));
        const ok = element(doc, 'button', 'typst-quick-input__ok');
        ok.type = 'button';
        ok.textContent = 'OK';
        ok.addEventListener('click', () => close(many.picked()));
        box.append(ok);
        picker = many;
      } else picker = new OnePicker(doc, list, { listbox, input: filter }, (item) => close(item));
      filter.addEventListener('input', () => picker.filter(filter.value));
      filter.addEventListener('keydown', (event) => picker.key(event));
      const close = this.#present<T | T[]>(box, filter, resolve);
    });
  }

  dispose(): void {
    this.#open?.cancel();
    this.host.removeEventListener('pointerdown', this.#remember, true);
    this.host.removeEventListener('keydown', this.#remember, true);
  }

  /** Remembers what the user pressed or typed in last: the next box goes below it. */
  readonly #remember = (event: Event): void => {
    const target = event.composedPath()[0];
    if (target instanceof Element && !this.#open?.box.contains(target)) this.#trigger = target;
  };

  /**
   * Shows `box` (cancelling an open one) at its anchor and focuses `focus`; Escape or a press outside resolves
   * undefined. Returns the close function that resolves with a value.
   */
  #present<R>(box: HTMLElement, focus: HTMLElement, resolve: (value: R | undefined) => void): (value: R) => void {
    this.#open?.cancel();
    const root = this.host.getRootNode() as Document | ShadowRoot;
    const previous = root.activeElement;
    const anchor = this.#anchor(root);
    const doc = this.host.ownerDocument;
    const outside = (event: MouseEvent) => {
      if (!event.composedPath().includes(box)) finish(undefined);
    };
    let done = false;
    const finish = (value: R | undefined) => {
      if (done) return;
      done = true;
      doc.removeEventListener('mousedown', outside, true);
      const hadFocus = box.contains(root.activeElement);
      box.remove();
      if (this.#open?.box === box) this.#open = null;
      if (hadFocus && previous instanceof HTMLElement && previous.isConnected) previous.focus();
      resolve(value);
    };
    box.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      finish(undefined);
    });
    this.#open = { box, cancel: () => finish(undefined) };
    this.host.append(box);
    this.#place(box, anchor);
    doc.addEventListener('mousedown', outside, true);
    focus.focus();
    return (value) => finish(value);
  }

  /** Where the box goes: below the selection in an editor, else below what the user last used; null: nothing. */
  #anchor(root: Document | ShadowRoot): { top: number; bottom: number; left: number } | null {
    // what is still shown: a menu entry may be hidden by now
    const shown = (candidate: Element | null): candidate is Element =>
      !!candidate?.isConnected && this.host.contains(candidate) && candidate.getClientRects().length > 0;
    const target = [this.#trigger, root.activeElement].find(shown);
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    if (target.closest('[contenteditable="true"], .cm-content')) {
      const selection = selectionRect(root);
      if (selection) return selection;
    }
    return rect.height > MAX_ANCHOR_HEIGHT ? { top: rect.top, bottom: rect.top, left: rect.left } : rect;
  }

  /** Below `anchor` (above where there is no room below), inside the widget; without one, at the top in the middle. */
  #place(box: HTMLElement, anchor: { top: number; bottom: number; left: number } | null): void {
    const frame = this.host.getBoundingClientRect();
    const originX = frame.left + this.host.clientLeft;
    const originY = frame.top + this.host.clientTop;
    const maxLeft = Math.max(0, this.host.clientWidth - box.offsetWidth);
    const maxTop = Math.max(0, this.host.clientHeight - box.offsetHeight);
    let left = maxLeft / 2;
    let top = Math.min(32, maxTop);
    if (anchor) {
      left = clamp(anchor.left - originX, 0, maxLeft);
      top = anchor.bottom - originY + GAP;
      const above = anchor.top - originY - GAP - box.offsetHeight;
      if (top > maxTop && above >= 0) top = above;
      top = clamp(top, 0, maxTop);
    }
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }
}

/** Picks one item: a listbox the filter field steers (arrows, Enter) with the active item marked. */
class OnePicker<T extends string | QuickPickItem> {
  readonly #options: { item: T; element: HTMLElement }[];
  #active = 0;

  private readonly input: HTMLInputElement;

  constructor(
    doc: Document,
    items: readonly T[],
    { listbox, input }: { listbox: HTMLElement; input: HTMLInputElement },
    private readonly pick: (item: T) => void,
  ) {
    this.input = input;
    listbox.setAttribute('role', 'listbox');
    listbox.id = `typst-quick-pick-${++ids}`;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', listbox.id);
    this.#options = items.map((item, index) => {
      const option = itemElement(doc, item);
      option.setAttribute('role', 'option');
      option.id = `${listbox.id}-${index}`;
      // keeps the focus in the filter field
      option.addEventListener('mousedown', (event) => event.preventDefault());
      option.addEventListener('click', () => pick(item));
      return { item, element: option };
    });
    listbox.append(...this.#options.map(({ element }) => element));
    this.filter('');
  }

  filter(text: string): void {
    for (const { item, element } of this.#options) element.hidden = !matches(item, text);
    this.#activate(0);
  }

  key(event: KeyboardEvent): void {
    const visible = this.#visible();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (visible.length > 0) this.#activate((this.#active + (event.key === 'ArrowDown' ? 1 : -1) + visible.length) % visible.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const active = visible[this.#active];
      if (active) this.pick(active.item);
    }
  }

  #visible() {
    return this.#options.filter(({ element }) => !element.hidden);
  }

  #activate(index: number): void {
    this.#active = index;
    const visible = this.#visible();
    for (const { element } of this.#options) element.setAttribute('aria-selected', 'false');
    const active = visible[index];
    if (active) {
      active.element.setAttribute('aria-selected', 'true');
      active.element.scrollIntoView?.({ block: 'nearest' });
      this.input.setAttribute('aria-activedescendant', active.element.id);
    } else this.input.removeAttribute('aria-activedescendant');
  }
}

/** Picks several: a checkbox per item; Enter in the filter field accepts the checked ones. */
class ManyPicker<T extends string | QuickPickItem> {
  readonly #options: { item: T; element: HTMLElement; checkbox: HTMLInputElement }[];

  constructor(
    doc: Document,
    items: readonly T[],
    listbox: HTMLElement,
    private readonly accept: () => void,
  ) {
    listbox.setAttribute('role', 'group');
    this.#options = items.map((item) => {
      const option = element(doc, 'label', 'typst-quick-pick__item');
      const checkbox = element(doc, 'input', 'typst-quick-pick__check');
      checkbox.type = 'checkbox';
      checkbox.checked = typeof item !== 'string' && !!item.picked;
      option.append(checkbox, ...itemElement(doc, item).childNodes);
      return { item, element: option, checkbox };
    });
    listbox.append(...this.#options.map(({ element }) => element));
  }

  filter(text: string): void {
    for (const { item, element } of this.#options) element.hidden = !matches(item, text);
  }

  key(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    this.accept();
  }

  picked(): T[] {
    return this.#options.filter(({ checkbox }) => checkbox.checked).map(({ item }) => item);
  }
}

function isArray<T>(items: readonly T[] | Promise<readonly T[]>): items is readonly T[] {
  return Array.isArray(items);
}

function labelOf(item: string | QuickPickItem): string {
  return typeof item === 'string' ? item : item.label;
}

function matches(item: string | QuickPickItem, text: string): boolean {
  return labelOf(item).toLowerCase().includes(text.trim().toLowerCase());
}

/** An item's label, description and detail. */
function itemElement(doc: Document, item: string | QuickPickItem): HTMLElement {
  const option = element(doc, 'div', 'typst-quick-pick__item');
  const label = element(doc, 'span', 'typst-quick-pick__label');
  label.textContent = labelOf(item);
  option.append(label);
  if (typeof item === 'string') return option;
  // a space before each further part: the option's accessible name reads as words
  if (item.description) {
    const description = element(doc, 'span', 'typst-quick-pick__description');
    description.textContent = item.description;
    option.append(' ', description);
  }
  if (item.detail) {
    const detail = element(doc, 'span', 'typst-quick-pick__detail');
    detail.textContent = item.detail;
    option.append(' ', detail);
  }
  return option;
}

function title(doc: Document, text: string | undefined): HTMLElement[] {
  if (!text) return [];
  const heading = element(doc, 'div', 'typst-quick-input__title');
  heading.textContent = text;
  heading.setAttribute('aria-hidden', 'true'); // the box's name already
  return [heading];
}

/** The selection in `root`: a shadow root's own where the browser has one (Chromium), else the document's. */
function selectionIn(root: Document | ShadowRoot): Selection | null {
  const own = (root as ShadowRoot & { getSelection?(): Selection | null }).getSelection;
  return typeof own === 'function' ? own.call(root) : (root.ownerDocument ?? (root as Document)).getSelection();
}

/** The selection's place on screen, if there is one with a size (a caret has a height). */
function selectionRect(root: Document | ShadowRoot): { top: number; bottom: number; left: number } | null {
  const selection = selectionIn(root);
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const rect = [...(range.getClientRects?.() ?? [])].find((r) => r.height > 0) ?? range.getBoundingClientRect?.();
  return rect && rect.height > 0 ? { top: rect.top, bottom: rect.bottom, left: rect.left } : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  return node;
}
