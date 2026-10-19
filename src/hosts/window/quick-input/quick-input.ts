// See WindowApi in ../window.ts.
import type { InputBoxOptions, QuickPickHighlights, QuickPickItem, QuickPickOptions } from '../window';

/**
 * What `showInputBox` and `showQuickPick` show, and the quick pick whose rows its owner sets while the user types
 * (search everywhere). One box at a time over the widget `host` (a new one cancels the open one), placed below its
 * anchor and kept inside the widget (above the anchor where there is no room below): the anchor is what the user last
 * pressed or typed in (a button, a row), or, in an editor, the selection; without one, at the top in the middle (as VS
 * Code's). Escape or a mouse press elsewhere cancels; closing gives the focus back to where it was (an editor's caret, too).
 *
 * @internal Extensions use it through `window.showQuickPick` and `window.showInputBox`.
 */
export class QuickInput {
  #trigger: Element | null = null;
  #open: Open | null = null;

  constructor(private readonly host: HTMLElement) {
    host.addEventListener('pointerdown', this.#remember, true);
    host.addEventListener('keydown', this.#remember, true);
  }

  /** Whether a box is open. */
  get isOpen(): boolean {
    return this.#open !== null;
  }

  showInputBox(options: InputBoxOptions = {}): Promise<string | undefined> {
    return new Promise((resolve) => {
      const doc = this.host.ownerDocument;
      const form = element(doc, 'form', 'zwf-quick-input');
      form.setAttribute('aria-label', options.title ?? options.prompt ?? 'Input');
      const input = element(doc, 'input', 'zwf-quick-input__field');
      input.type = 'text';
      input.value = options.value ?? '';
      input.placeholder = options.placeHolder ?? '';
      input.setAttribute('aria-label', options.prompt ?? options.title ?? 'Input');
      const ok = element(doc, 'button', 'zwf-quick-input__ok');
      ok.type = 'submit';
      ok.textContent = 'OK';
      const row = element(doc, 'div', 'zwf-quick-input__row');
      row.append(input, ok);
      const message = element(doc, 'div', 'zwf-quick-input__message');
      message.setAttribute('role', 'alert');
      form.append(...title(doc, options.title), row);
      if (options.prompt) {
        const prompt = element(doc, 'div', 'zwf-quick-input__prompt');
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

  /**
   * Opens a quick pick at the top in the middle of the widget, wider than `showQuickPick`'s, whose rows the owner
   * sets as the text changes (`onDidChangeValue` → `setEntries`). Cancels the open box.
   */
  createQuickPick<T extends string | QuickPickItem>(options: DynamicQuickPickOptions<T>): DynamicQuickPick<T> {
    const doc = this.host.ownerDocument;
    const box = element(doc, 'div', 'zwf-quick-input zwf-quick-pick zwf-quick-pick--wide');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', options.title);
    const filter = element(doc, 'input', 'zwf-quick-input__field');
    filter.type = 'text';
    filter.value = options.value ?? '';
    filter.placeholder = options.placeHolder ?? '';
    filter.setAttribute('aria-label', options.title);
    const progress = element(doc, 'div', 'zwf-quick-pick__progress');
    progress.hidden = true;
    const listbox = element(doc, 'div', 'zwf-quick-pick__list');
    const empty = element(doc, 'div', 'zwf-quick-pick__empty');
    empty.textContent = 'No results';
    empty.hidden = true;
    box.append(filter, progress, listbox, empty, ...hint(doc, filter, options.hint));
    const picker = new OnePicker<T>(doc, { listbox, input: filter }, (item) => close(item));
    let busy = false;
    const showEmpty = () => (empty.hidden = busy || picker.size > 0 || filter.value.trim() === '');
    const changed = () => options.onDidChangeValue(filter.value);
    filter.addEventListener('input', changed);
    filter.addEventListener('keydown', (event) => picker.key(event));
    const close = this.#present<T>(box, filter, (item) => {
      if (item !== undefined) options.onDidAccept(item);
      options.onDidHide();
    }, false);
    filter.setSelectionRange(filter.value.length, filter.value.length);
    return {
      setEntries: (entries) => {
        picker.show(entries);
        showEmpty();
      },
      setBusy: (now) => {
        busy = now;
        progress.hidden = !now;
        showEmpty();
      },
      setValue: (value) => {
        filter.value = value;
        changed();
      },
      hide: () => this.#open?.box === box && this.#open.cancel(),
    };
  }

  #pick<T extends string | QuickPickItem>(list: readonly T[], options: QuickPickOptions): Promise<T | T[] | undefined> {
    return new Promise((resolve) => {
      const doc = this.host.ownerDocument;
      const box = element(doc, 'div', 'zwf-quick-input zwf-quick-pick');
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', options.title ?? options.placeHolder ?? 'Pick');
      const filter = element(doc, 'input', 'zwf-quick-input__field');
      filter.type = 'text';
      filter.placeholder = options.placeHolder ?? '';
      filter.setAttribute('aria-label', options.placeHolder ?? options.title ?? 'Filter');
      const listbox = element(doc, 'div', 'zwf-quick-pick__list');
      box.append(...title(doc, options.title), filter, listbox);
      let picker: { filter(text: string): void; key(event: KeyboardEvent): void };
      if (options.canPickMany) {
        const many = new ManyPicker(doc, list, listbox, () => close(many.picked()));
        const ok = element(doc, 'button', 'zwf-quick-input__ok');
        ok.type = 'button';
        ok.textContent = 'OK';
        ok.addEventListener('click', () => close(many.picked()));
        box.append(ok);
        picker = many;
      } else {
        const one = new OnePicker(doc, { listbox, input: filter }, (item: T) => close(item));
        picker = { filter: (text) => one.show(list.filter((item) => matches(item, text)).map((item) => ({ kind: 'item', item }))), key: (event) => one.key(event) };
        picker.filter('');
      }
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
   * Shows `box` (cancelling an open one) at its anchor (`anchored`; else at the top in the middle) and focuses
   * `focus`; Escape or a press outside resolves undefined. Returns the close function that resolves with a value.
   */
  #present<R>(box: HTMLElement, focus: HTMLElement, resolve: (value: R | undefined) => void, anchored = true): (value: R) => void {
    this.#open?.cancel();
    const root = this.host.getRootNode() as Document | ShadowRoot;
    const previous = root.activeElement;
    const caret = caretIn(root, previous);
    const anchor = anchored ? this.#anchor(root) : null;
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
      if (hadFocus && previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
        caret?.restore();
      }
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
    // a control inside an editor (an image box's toolbar) is the anchor itself, not the editor's selection
    if (!target.closest(CONTROLS) && target.closest('[contenteditable="true"], .cm-content')) {
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

/** A heading starting a group of items (VS Code's separator item), with a note after it. */
export interface QuickPickSeparator {
  readonly kind: 'separator';
  readonly label: string;
  readonly description?: string;
}

/** An item of a quick pick, with the characters to highlight. */
export interface QuickPickItemEntry<T> {
  readonly kind: 'item';
  readonly item: T;
  readonly highlights?: QuickPickHighlights;
}

/** A row of a quick pick: an item, or a heading starting a group. */
export type QuickPickEntry<T> = QuickPickItemEntry<T> | QuickPickSeparator;

/** What a dynamic quick pick shows and whom it tells (see `QuickInput.createQuickPick`). */
export interface DynamicQuickPickOptions<T> {
  /** The box's accessible name and the field's label. */
  readonly title: string;
  readonly placeHolder?: string;
  /** The text the field starts with (the caret after it). */
  readonly value?: string;
  /** A line below the list, read as the field's description (e.g. how to narrow the search). */
  readonly hint?: string;
  /** The text in the field changed (typed, or `setValue`; not for the starting `value`). */
  onDidChangeValue(value: string): void;
  /** An item was picked (Enter or a click); the box is gone and the focus back where it was. */
  onDidAccept(item: T): void;
  /** The box is gone (after `onDidAccept`, on Escape, a press outside, another box, or `hide`). */
  onDidHide(): void;
}

/** A quick pick whose rows its owner sets while the user types (VS Code's `window.createQuickPick`, as far as needed). */
export interface DynamicQuickPick<T> {
  /** Shows these rows, the first item active; without any item, "No results" (unless busy). */
  setEntries(entries: readonly QuickPickEntry<T>[]): void;
  /** Rows are still coming (a progress line). */
  setBusy(busy: boolean): void;
  /** Sets the field's text (as if typed). */
  setValue(value: string): void;
  /** Closes it (as Escape). */
  hide(): void;
}

/** A box on screen: closing it removes it and gives the focus back. */
interface Open {
  readonly box: HTMLElement;
  cancel(): void;
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  return node;
}

function title(doc: Document, text: string | undefined): HTMLElement[] {
  if (!text) return [];
  const heading = element(doc, 'div', 'zwf-quick-input__title');
  heading.textContent = text;
  heading.setAttribute('aria-hidden', 'true'); // the box's name already
  return [heading];
}

function isArray<T>(items: readonly T[] | Promise<readonly T[]>): items is readonly T[] {
  return Array.isArray(items);
}

/** The line below the list, describing `field`. */
function hint(doc: Document, field: HTMLElement, text: string | undefined): HTMLElement[] {
  if (!text) return [];
  const line = element(doc, 'div', 'zwf-quick-pick__hint');
  line.id = `zwf-quick-pick-hint-${++ids}`;
  line.textContent = text;
  field.setAttribute('aria-describedby', line.id);
  return [line];
}

let ids = 0;

/** Picks one item: a listbox the filter field steers (arrows, Enter) with the active item marked; groups under headings. */
class OnePicker<T extends string | QuickPickItem> {
  #options: { item: T; element: HTMLElement }[] = [];
  #active = 0;
  #rows = 0;

  constructor(
    private readonly doc: Document,
    private readonly parts: { listbox: HTMLElement; input: HTMLInputElement },
    private readonly pick: (item: T) => void,
  ) {
    const { listbox, input } = parts;
    listbox.setAttribute('role', 'listbox');
    listbox.id = `zwf-quick-pick-${++ids}`;
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', listbox.id);
  }

  /** How many items are shown. */
  get size(): number {
    return this.#options.length;
  }

  /** Shows `entries` (items, and headings starting groups), the first item active. */
  show(entries: readonly QuickPickEntry<T>[]): void {
    this.#options = [];
    const rows: HTMLElement[] = [];
    let group: HTMLElement | null = null;
    for (const entry of entries) {
      if (entry.kind === 'separator') rows.push((group = this.#group(entry)));
      else if (group) group.append(this.#option(entry));
      else rows.push(this.#option(entry));
    }
    this.parts.listbox.replaceChildren(...rows);
    this.#activate(0);
  }

  key(event: KeyboardEvent): void {
    const count = this.#options.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (count > 0) this.#activate((this.#active + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const active = this.#options[this.#active];
      if (active) this.pick(active.item);
    }
  }

  /** A group under a heading, which names it. */
  #group(separator: QuickPickSeparator): HTMLElement {
    const group = element(this.doc, 'div', 'zwf-quick-pick__group');
    group.setAttribute('role', 'group');
    const heading = element(this.doc, 'div', 'zwf-quick-pick__heading');
    heading.id = `${this.parts.listbox.id}-${++this.#rows}`;
    heading.setAttribute('role', 'presentation');
    heading.textContent = separator.label;
    if (separator.description) {
      const description = element(this.doc, 'span', 'zwf-quick-pick__heading-description');
      description.textContent = separator.description;
      heading.append(' ', description);
    }
    group.setAttribute('aria-labelledby', heading.id);
    group.append(heading);
    return group;
  }

  #option({ item, highlights }: QuickPickItemEntry<T>): HTMLElement {
    const option = itemElement(this.doc, item, highlights);
    option.setAttribute('role', 'option');
    option.id = `${this.parts.listbox.id}-${++this.#rows}`;
    // keeps the focus in the filter field
    option.addEventListener('mousedown', (event) => event.preventDefault());
    option.addEventListener('click', () => this.pick(item));
    this.#options.push({ item, element: option });
    return option;
  }

  #activate(index: number): void {
    this.#active = index;
    for (const { element } of this.#options) element.setAttribute('aria-selected', 'false');
    const active = this.#options[index];
    if (active) {
      active.element.setAttribute('aria-selected', 'true');
      active.element.scrollIntoView?.({ block: 'nearest' });
      this.parts.input.setAttribute('aria-activedescendant', active.element.id);
    } else this.parts.input.removeAttribute('aria-activedescendant');
  }
}

/** An item's label, description, key (search everywhere's) and detail, the `highlights` marked. */
function itemElement(doc: Document, item: string | (QuickPickItem & { keybinding?: string }), highlights: QuickPickHighlights = {}): HTMLElement {
  const option = element(doc, 'div', 'zwf-quick-pick__item');
  option.append(highlighted(doc, 'zwf-quick-pick__label', labelOf(item), highlights.label));
  if (typeof item === 'string') return option;
  // a space before each further part: the option's accessible name reads as words
  if (item.description) option.append(' ', highlighted(doc, 'zwf-quick-pick__description', item.description, highlights.description));
  if (item.keybinding) {
    const key = element(doc, 'kbd', 'zwf-quick-pick__keybinding');
    key.textContent = item.keybinding;
    option.append(' ', key);
  }
  if (item.detail) option.append(' ', highlighted(doc, 'zwf-quick-pick__detail', item.detail, highlights.detail));
  return option;
}

/** A span of `text` with the characters in `ranges` in `<mark>`s. */
function highlighted(doc: Document, className: string, text: string, ranges: QuickPickHighlights['label'] = []): HTMLElement {
  const span = element(doc, 'span', className);
  let last = 0;
  for (const [start, end] of ranges) {
    if (start < last || end > text.length) continue;
    const mark = element(doc, 'mark', 'zwf-quick-pick__match');
    mark.textContent = text.slice(start, end);
    span.append(text.slice(last, start), mark);
    last = end;
  }
  span.append(text.slice(last));
  return span;
}

function labelOf(item: string | QuickPickItem): string {
  return typeof item === 'string' ? item : item.label;
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
      const option = element(doc, 'label', 'zwf-quick-pick__item');
      const checkbox = element(doc, 'input', 'zwf-quick-pick__check');
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

function matches(item: string | QuickPickItem, text: string): boolean {
  return labelOf(item).toLowerCase().includes(text.trim().toLowerCase());
}

/** The selection's place on screen, if there is one with a size (a caret has a height). */
function selectionRect(root: Document | ShadowRoot): { top: number; bottom: number; left: number } | null {
  const selection = selectionIn(root);
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const rect = [...(range.getClientRects?.() ?? [])].find((r) => r.height > 0) ?? range.getBoundingClientRect?.();
  return rect && rect.height > 0 ? { top: rect.top, bottom: rect.bottom, left: rect.left } : null;
}

/**
 * The selection inside `element` (an editor's caret), to put back after focusing it again: focusing an editable element
 * whose selection went elsewhere sets the caret to its start (Chromium), which the editor would take for the user's.
 */
function caretIn(root: Document | ShadowRoot, element: Element | null): { restore(): void } | null {
  const selection = selectionIn(root);
  if (!element || !selection || selection.rangeCount === 0 || !element.contains(selection.anchorNode)) return null;
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
  return {
    restore: () => {
      if (anchorNode!.isConnected && focusNode!.isConnected) selection.setBaseAndExtent(anchorNode!, within(anchorNode!, anchorOffset), focusNode!, within(focusNode!, focusOffset));
    },
  };
}

/** `offset` in `node`, at most its end (the node may have shrunk meanwhile). */
function within(node: Node, offset: number): number {
  return Math.min(offset, node.nodeType === node.TEXT_NODE ? (node as Text).length : node.childNodes.length);
}

/** The selection in `root`: a shadow root's own where the browser has one (Chromium), else the document's. */
function selectionIn(root: Document | ShadowRoot): Selection | null {
  const own = (root as ShadowRoot & { getSelection?(): Selection | null }).getSelection;
  return typeof own === 'function' ? own.call(root) : (root.ownerDocument ?? (root as Document)).getSelection();
}

/** What the user presses rather than types in. */
const CONTROLS = 'button, input, select, textarea, a[href], [role="button"], [role="menuitem"]';

/** Elements taller than this (an editor's whole text) are no anchor: the box goes to their top instead. */
const MAX_ANCHOR_HEIGHT = 120;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Between the anchor and the box. */
const GAP = 4;
