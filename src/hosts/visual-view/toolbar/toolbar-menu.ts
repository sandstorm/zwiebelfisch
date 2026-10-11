// ToolbarMenu: a toolbar button that opens a menu of further buttons (Insert ▾, Align ▾), the toolbar's `menu`
// groups. See toolbar.ts and docs/architecture/visual-view.typ.

/**
 * A menu button of the toolbar: the trigger (icon, a small caret,
 * `aria-haspopup`) opens a `role="menu"` list of `items` below it. Choosing an
 * item, Escape, or a click elsewhere closes it; arrow keys move between the
 * items. The items are ordinary toolbar buttons (their enabled/pressed state
 * is the toolbar's business); the trigger shows `icon()` as of the last
 * `refresh()`, e.g. the current alignment.
 */
export class ToolbarMenu {
  readonly element: HTMLElement;
  private readonly trigger: HTMLButtonElement;
  private readonly list: HTMLElement;
  private readonly glyph: HTMLElement;
  /** Closes on a mousedown outside; the composed path sees through shadow roots (`<typst-editor>`). */
  private readonly outside = (event: MouseEvent) => {
    if (!event.composedPath().includes(this.element)) this.close();
  };

  constructor(
    doc: Document,
    label: string,
    private readonly icon: () => string,
    private readonly items: HTMLButtonElement[],
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
    for (const item of items) {
      item.setAttribute('role', 'menuitem');
      item.classList.add('typst-toolbar__menu-item');
      const text = doc.createElement('span');
      text.textContent = item.getAttribute('aria-label');
      item.append(text);
      // after the item's own click handler: the menu closes once the item has acted
      item.addEventListener('click', () => this.close());
    }
    this.list.append(...items);
    this.list.addEventListener('keydown', (event) => this.navigate(event));
    this.element.append(this.trigger, this.list);
    this.refresh();
  }

  /** Shows `icon()` on the trigger as it is now. */
  refresh(): void {
    this.glyph.innerHTML = this.icon();
  }

  dispose(): void {
    this.close();
    this.element.remove();
  }

  private get isOpen(): boolean {
    return !this.list.hidden;
  }

  private open(): void {
    this.list.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.element.ownerDocument.addEventListener('mousedown', this.outside, true);
  }

  private close(): void {
    this.list.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    this.element.ownerDocument.removeEventListener('mousedown', this.outside, true);
  }

  private navigate(event: KeyboardEvent): void {
    const enabled = this.items.filter((item) => !item.disabled && !item.hidden);
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
