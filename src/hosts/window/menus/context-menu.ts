// See WindowApi in ../window.ts.
import { type CommandsHost, keyLabel } from '../../commands/commands';
import type { ContextMenuOptions, MenuAnchor } from '../window';
import type { Menus } from './menus';

/**
 * What `showContextMenu` shows. One menu at a time over the widget `host` (a new one closes the open one): a
 * `role="menu"` list of the menu's entries, a separator between groups, an entry with `toggled` as a checkbox entry
 * (`menuitemcheckbox`, a check mark while it holds), an entry's key at its end, fixed at its anchor and kept inside the
 * viewport. The first entry gets the focus; arrow keys, Home and End move it. Choosing an entry, Escape, Tab or a press
 * elsewhere closes the menu and gives the focus back to the element that had it; a chosen entry's command runs after
 * that (a failing one is logged: it tells the user itself). A menu without entries is not shown.
 *
 * @internal Extensions use it through `window.showContextMenu`, with entries from `window.registerMenuItem`.
 */
export class ContextMenu {
  #open: MenuList | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly menus: Menus,
    /** Runs a chosen entry's command with the menu's arguments; names the entries' keys. */
    private readonly commands: Pick<CommandsHost, 'executeCommand' | 'keybindingLabel'>,
  ) {}

  show(menuId: string, options: ContextMenuOptions): void {
    this.#open?.close();
    this.#open = null;
    const context = options.context ?? {};
    const items = this.menus.items(menuId, context);
    if (items.length === 0) return;
    const args = options.args ?? [];
    const entries = items.map((item) => ({
      label: item.title ?? item.command,
      group: item.group,
      keybinding: this.commands.keybindingLabel(item.command) ?? (item.keybinding && keyLabel(item.keybinding)),
      checked: item.toggled?.(context),
      run: () => this.#run(item.command, args),
    }));
    this.#open = new MenuList(this.host, options.title, entries, options.anchor);
  }

  dispose(): void {
    this.#open?.close();
    this.#open = null;
  }

  #run(command: string, args: readonly unknown[]): void {
    this.commands.executeCommand(command, ...args).catch((error: unknown) => console.error(`Command ${command} failed:`, error));
  }
}

/** The menu's element in `container` while it is open. */
class MenuList {
  readonly #element: HTMLElement;
  readonly #items: HTMLButtonElement[] = [];
  readonly #returnFocus: Element | null;
  #closed = false;

  constructor(container: HTMLElement, label: string, entries: readonly Entry[], anchor: MenuAnchor) {
    const doc = container.ownerDocument;
    this.#returnFocus = (container.getRootNode() as Document | ShadowRoot).activeElement;
    this.#element = element(doc, 'div', 'zwf-context-menu');
    this.#element.setAttribute('role', 'menu');
    this.#element.setAttribute('aria-label', label);
    // a column for the check marks, so every entry's label starts at the same place
    this.#element.classList.toggle('zwf-context-menu--checks', entries.some((entry) => entry.checked !== undefined));
    entries.forEach((entry, index) => {
      if (index > 0 && (entry.group ?? '') !== (entries[index - 1].group ?? '')) this.#element.append(separator(doc));
      this.#element.append(this.#item(doc, entry));
    });
    this.#element.addEventListener('keydown', (event) => this.#key(event));
    container.append(this.#element);
    this.#place(anchor);
    doc.addEventListener('mousedown', this.#outside, true);
    this.#items[0]?.focus();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#element.ownerDocument.removeEventListener('mousedown', this.#outside, true);
    const hadFocus = this.#element.contains((this.#element.getRootNode() as Document | ShadowRoot).activeElement);
    this.#element.remove();
    if (hadFocus && this.#returnFocus instanceof HTMLElement && this.#returnFocus.isConnected) this.#returnFocus.focus();
  }

  #item(doc: Document, entry: Entry): HTMLButtonElement {
    const item = element(doc, 'button', 'zwf-context-menu__item');
    item.type = 'button';
    item.setAttribute('role', entry.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
    if (entry.checked !== undefined) item.setAttribute('aria-checked', String(entry.checked));
    item.tabIndex = -1;
    const check = element(doc, 'span', 'zwf-context-menu__check');
    check.setAttribute('aria-hidden', 'true');
    check.textContent = entry.checked ? '✓' : '';
    item.append(check, entry.label);
    if (entry.keybinding) item.append(' ', element(doc, 'kbd', 'zwf-context-menu__keybinding', entry.keybinding));
    item.addEventListener('click', () => {
      this.close();
      entry.run();
    });
    this.#items.push(item);
    return item;
  }

  readonly #outside = (event: MouseEvent): void => {
    if (!event.composedPath().includes(this.#element)) this.close();
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

  #place(anchor: MenuAnchor): void {
    const view = this.#element.ownerDocument.defaultView;
    const point = anchor instanceof Element ? { x: anchor.getBoundingClientRect().left, y: anchor.getBoundingClientRect().bottom } : anchor;
    const maxX = Math.max(0, (view?.innerWidth ?? 0) - this.#element.offsetWidth);
    const maxY = Math.max(0, (view?.innerHeight ?? 0) - this.#element.offsetHeight);
    this.#element.style.left = `${Math.min(Math.max(point.x, 0), maxX)}px`;
    this.#element.style.top = `${Math.min(Math.max(point.y, 0), maxY)}px`;
  }
}

interface Entry {
  readonly label: string;
  readonly group?: string;
  readonly keybinding?: string;
  /** Checked or not for a checkbox entry; undefined for any other. */
  readonly checked?: boolean;
  run(): void;
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function separator(doc: Document): HTMLElement {
  const node = element(doc, 'div', 'zwf-context-menu__separator');
  node.setAttribute('role', 'separator');
  return node;
}
