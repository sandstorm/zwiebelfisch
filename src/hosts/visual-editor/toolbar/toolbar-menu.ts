// ToolbarMenu: a toolbar button that opens a menu of further buttons (Insert ▾, Align ▾, Styles ▾ in the selection
// bar), the toolbar's `menu` groups. See Toolbar in toolbar.ts.
import type { ToolbarControl } from '../visual-editor';

/**
 * A menu button of the toolbar: its trigger opens a `role="menu"` list of toolbar buttons below it.
 *
 * Choosing an item, Escape or a click elsewhere closes it; arrow keys move between the items. The items are asked for
 * each time the menu opens, so they follow what it holds now; a menu without items hides. The trigger shows `icon()` as
 * of the last `refresh()` (e.g. the current alignment).
 *
 * @internal Extensions get one through `visualEditor.registerToolbarGroup` (`kind: 'menu'`).
 */
export class ToolbarMenu implements ToolbarControl {
  readonly element: HTMLElement;
  private readonly trigger: HTMLButtonElement;
  private readonly list: HTMLElement;
  private readonly glyph: HTMLElement;
  /** The icon on the trigger. */
  private shown = '';
  /** The items while the menu is open. */
  private items: MenuItems = { buttons: [], refresh: () => {} };
  /** Closes on a mousedown outside; the composed path sees through shadow roots (`<zwiebelfisch-editor>`). */
  private readonly outside = (event: MouseEvent) => {
    if (!event.composedPath().includes(this.element)) this.close();
  };

  constructor(
    doc: Document,
    label: string,
    private readonly content: MenuContent,
  ) {
    this.element = doc.createElement('div');
    this.element.className = 'zwf-toolbar__menu';
    this.trigger = doc.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'zwf-toolbar__button zwf-toolbar__menu-button';
    this.trigger.setAttribute('aria-label', label);
    this.trigger.setAttribute('aria-haspopup', 'menu');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.title = label;
    this.glyph = doc.createElement('span');
    this.glyph.className = 'zwf-toolbar__menu-icon';
    const caret = doc.createElement('span');
    caret.className = 'zwf-toolbar__caret';
    caret.setAttribute('aria-hidden', 'true');
    this.trigger.append(this.glyph, caret);
    this.trigger.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    this.list = doc.createElement('div');
    this.list.className = 'zwf-toolbar__menu-list';
    this.list.setAttribute('role', 'menu');
    this.list.setAttribute('aria-label', label);
    this.list.hidden = true;
    this.list.addEventListener('keydown', (event) => this.navigate(event));
    this.element.append(this.trigger, this.list);
    this.showItems();
    this.refresh();
  }

  /** Shows `icon()` on the trigger as it is now (the menu hidden without items), and the items' state while it is open. */
  refresh(): void {
    // after every transaction: parse the icon only when it changed
    const icon = this.content.icon();
    if (icon !== this.shown) this.glyph.innerHTML = this.shown = icon;
    this.element.hidden = !this.hasItems;
    if (this.isOpen) this.items.refresh();
  }

  /** Whether it has items now; it shows only then. */
  get hasItems(): boolean {
    return this.content.hasItems();
  }

  dispose(): void {
    this.close();
    this.element.remove();
  }

  private get isOpen(): boolean {
    return !this.list.hidden;
  }

  private open(): void {
    this.showItems();
    this.items.refresh();
    this.list.hidden = false;
    this.fit();
    this.trigger.setAttribute('aria-expanded', 'true');
    this.element.ownerDocument.addEventListener('mousedown', this.outside, true);
  }

  /** Puts the items as of now in the list, unless they are the ones there. */
  private showItems(): void {
    const items = this.content.items();
    if (items === this.items) return;
    this.items = items;
    const doc = this.element.ownerDocument;
    for (const item of items.buttons) {
      item.setAttribute('role', 'menuitem');
      item.classList.add('zwf-toolbar__menu-item');
      const text = doc.createElement('span');
      text.textContent = item.getAttribute('aria-label');
      item.append(text);
      // after the item's own click handler: the menu closes once the item has acted
      item.addEventListener('click', () => this.close());
    }
    this.list.replaceChildren(...items.buttons);
  }

  /** Limits the open list to the room below the trigger that shows: the nearest clipping ancestor's, the window's. */
  private fit(): void {
    this.list.style.maxHeight = '';
    const view = this.element.ownerDocument.defaultView;
    const bottom = Math.min(clipBottom(this.element), view?.innerHeight ?? Infinity);
    const room = bottom - this.list.getBoundingClientRect().top - MENU_MARGIN;
    if (room < this.list.scrollHeight) this.list.style.maxHeight = `${Math.max(room, MENU_MIN_HEIGHT)}px`;
  }

  private close(): void {
    this.list.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    this.element.ownerDocument.removeEventListener('mousedown', this.outside, true);
  }

  private navigate(event: KeyboardEvent): void {
    const enabled = this.items.buttons.filter((item) => !item.disabled && !item.hidden);
    const at = enabled.indexOf(event.target as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
      this.trigger.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      enabled[(at + step + enabled.length) % enabled.length]?.focus();
    }
  }
}

/** Room left below an open menu's list (px). */
const MENU_MARGIN = 8;
/** The least height of a list that has to scroll (px): a few items, however little room there is. */
const MENU_MIN_HEIGHT = 96;

/** The bottom edge of the nearest ancestor of `element` that clips what sticks out (through shadow roots); Infinity without. */
function clipBottom(element: Element): number {
  for (let node = parentOf(element); node; node = parentOf(node)) {
    const style = getComputedStyle(node);
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') return node.getBoundingClientRect().bottom;
  }
  return Infinity;
}

/** `element`'s parent element, or its shadow root's host. */
function parentOf(element: Element): Element | null {
  const parent = element.parentNode;
  return parent instanceof Element ? parent : parent instanceof ShadowRoot ? parent.host : null;
}

/** What a menu holds: its trigger's icon and its items, as of now. */
export interface MenuContent {
  icon(): string;
  /** Whether it has items (a menu without hides). */
  hasItems(): boolean;
  /** Its items, asked when the menu is made and whenever it opens: the same object while they stay the same. */
  items(): MenuItems;
}

/** A menu's items: their buttons, and how to show their state. */
export interface MenuItems {
  readonly buttons: readonly HTMLButtonElement[];
  refresh(): void;
}
