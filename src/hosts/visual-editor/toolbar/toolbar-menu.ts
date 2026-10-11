// ToolbarMenu: a toolbar button that opens a menu of further buttons (Insert ▾, Align ▾, Styles ▾ in the selection
// bar), the toolbar's `menu` groups. See Toolbar in toolbar.ts.
import type { ToolbarControl } from '../visual-editor';

/**
 * A menu button of the toolbar: the trigger (icon, a small caret,
 * `aria-haspopup`) opens a `role="menu"` list of items below it. Choosing an
 * item, Escape, or a click elsewhere closes it; arrow keys move between the
 * items. The items are ordinary toolbar buttons (their enabled/pressed state
 * is the toolbar's business), asked for again each time the menu opens, so
 * they follow what the menu holds now (the project's inline styles); a menu
 * without items hides. The trigger shows `icon()` as of the last `refresh()`,
 * e.g. the current alignment. The items' state is invisible while the menu is
 * closed: it is refreshed when the menu opens and on `refresh()` while it is
 * open, not after every transaction.
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
  /** Closes on a mousedown outside; the composed path sees through shadow roots (`<typst-editor>`). */
  private readonly outside = (event: MouseEvent) => {
    if (!event.composedPath().includes(this.element)) this.close();
  };

  constructor(
    doc: Document,
    label: string,
    private readonly content: MenuContent,
  ) {
    this.element = doc.createElement('div');
    this.element.className = 'typst-toolbar__menu';
    this.trigger = doc.createElement('button');
    this.trigger.type = 'button';
    this.trigger.className = 'typst-toolbar__button typst-toolbar__menu-button';
    this.trigger.setAttribute('aria-label', label);
    this.trigger.setAttribute('aria-haspopup', 'menu');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.title = label;
    this.glyph = doc.createElement('span');
    this.glyph.className = 'typst-toolbar__menu-icon';
    const caret = doc.createElement('span');
    caret.className = 'typst-toolbar__caret';
    caret.setAttribute('aria-hidden', 'true');
    this.trigger.append(this.glyph, caret);
    this.trigger.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
    this.list = doc.createElement('div');
    this.list.className = 'typst-toolbar__menu-list';
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
      item.classList.add('typst-toolbar__menu-item');
      const text = doc.createElement('span');
      text.textContent = item.getAttribute('aria-label');
      item.append(text);
      // after the item's own click handler: the menu closes once the item has acted
      item.addEventListener('click', () => this.close());
    }
    this.list.replaceChildren(...items.buttons);
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
