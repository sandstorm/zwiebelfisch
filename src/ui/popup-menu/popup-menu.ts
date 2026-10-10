// PopupMenu: a menu that pops up at a point or below a button (a context menu, a "New ▾" menu) and closes once an
// entry is chosen. Entry of ui/popup-menu/, a feature-neutral widget. See ARCHITECTURE.md, "File panel".

/** An entry of a popup menu. */
export interface PopupMenuEntry {
  readonly label: string;
  /** Called after the menu closed (the focus is back where it was). */
  run(): void;
  /** Entries of another group follow a separator. */
  readonly group?: string;
}

/** Where the menu pops up: at a point (viewport coordinates, e.g. a right click's), or below an element. */
export type PopupMenuAnchor = { x: number; y: number } | Element;

/**
 * A `role="menu"` list of `entries` in `container`, fixed at `anchor` and kept inside the viewport. The first entry
 * gets the focus; arrow keys, Home and End move it. Choosing an entry, Escape or a press elsewhere closes the menu
 * and gives the focus back to the element that had it; a chosen entry runs after that.
 */
export class PopupMenu {
  readonly element: HTMLElement;
  readonly #items: HTMLButtonElement[];
  readonly #returnFocus: Element | null;
  #closed = false;

  constructor(container: HTMLElement, label: string, entries: readonly PopupMenuEntry[], anchor: PopupMenuAnchor) {
    const doc = container.ownerDocument;
    this.#returnFocus = (container.getRootNode() as Document | ShadowRoot).activeElement;
    this.element = doc.createElement('div');
    this.element.className = 'typst-popup-menu';
    this.element.setAttribute('role', 'menu');
    this.element.setAttribute('aria-label', label);
    this.#items = [];
    let group: string | undefined;
    for (const [index, entry] of entries.entries()) {
      if (index > 0 && (entry.group ?? '') !== (group ?? '')) {
        const separator = doc.createElement('div');
        separator.className = 'typst-popup-menu__separator';
        separator.setAttribute('role', 'separator');
        this.element.append(separator);
      }
      group = entry.group;
      const item = doc.createElement('button');
      item.type = 'button';
      item.className = 'typst-popup-menu__item';
      item.setAttribute('role', 'menuitem');
      item.tabIndex = -1;
      item.textContent = entry.label;
      item.addEventListener('click', () => {
        this.close();
        entry.run();
      });
      this.#items.push(item);
      this.element.append(item);
    }
    this.element.addEventListener('keydown', (event) => this.#key(event));
    container.append(this.element);
    this.#place(anchor);
    doc.addEventListener('mousedown', this.#outside, true);
    this.#items[0]?.focus();
  }

  get isOpen(): boolean {
    return !this.#closed;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.element.ownerDocument.removeEventListener('mousedown', this.#outside, true);
    const hadFocus = this.element.contains((this.element.getRootNode() as Document | ShadowRoot).activeElement);
    this.element.remove();
    if (hadFocus && this.#returnFocus instanceof HTMLElement && this.#returnFocus.isConnected) this.#returnFocus.focus();
  }

  readonly #outside = (event: MouseEvent): void => {
    if (!event.composedPath().includes(this.element)) this.close();
  };

  #key(event: KeyboardEvent): void {
    const at = this.#items.indexOf(event.target as HTMLButtonElement);
    const count = this.#items.length;
    const next: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1 + count, Home: 0, End: count - 1 };
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      this.close();
    } else if (event.key in next && count > 0) {
      event.preventDefault();
      this.#items[next[event.key] % count].focus();
    }
  }

  #place(anchor: PopupMenuAnchor): void {
    const view = this.element.ownerDocument.defaultView;
    const point = anchor instanceof Element ? { x: anchor.getBoundingClientRect().left, y: anchor.getBoundingClientRect().bottom } : anchor;
    const maxX = Math.max(0, (view?.innerWidth ?? 0) - this.element.offsetWidth);
    const maxY = Math.max(0, (view?.innerHeight ?? 0) - this.element.offsetHeight);
    this.element.style.left = `${Math.min(Math.max(point.x, 0), maxX)}px`;
    this.element.style.top = `${Math.min(Math.max(point.y, 0), maxY)}px`;
  }
}
