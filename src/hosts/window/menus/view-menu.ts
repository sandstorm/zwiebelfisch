// ViewMenu: the "View" button of the title bar, which pops up the menu `window/view`. See registerMenuItem in ../window.ts.
import type { Disposable } from '../../../core/disposable/disposable';
import type { MenuContext } from '../../commands/commands';
import type { ContextMenuOptions } from '../window';
import type { Menus } from './menus';

/**
 * "View ▾" in the title bar while the menu `window/view` has entries whose `when` holds in the current context (how
 * the editors and the preview show things); a click pops the menu up below it, with check marks. Checked again on
 * `update` (the shown file or editor changed) and whenever the menu's entries change.
 *
 * @internal Extensions add to it through `window.registerMenuItem('window/view', …)`.
 */
export class ViewMenu {
  readonly #button: HTMLButtonElement;
  readonly #subscriptions: Disposable[];

  constructor(
    doc: Document,
    private readonly menus: Menus,
    private readonly options: ViewMenuOptions,
  ) {
    this.#button = doc.createElement('button');
    this.#button.type = 'button';
    this.#button.className = 'zwf-editor__view-menu';
    this.#button.title = 'View';
    this.#button.setAttribute('aria-haspopup', 'menu');
    const text = doc.createElement('span');
    text.textContent = 'View';
    const chevron = doc.createElement('span');
    chevron.className = 'zwf-editor__view-menu-icon';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = CHEVRON_ICON;
    this.#button.append(text, chevron);
    // the menu's commands act on the editor's selection: the focus stays there
    this.#button.addEventListener('mousedown', (event) => event.preventDefault());
    this.#button.addEventListener('click', () => options.showContextMenu(VIEW, { anchor: this.#button, title: 'View', context: options.context() }));
    this.#subscriptions = [options.place(this.#button), menus.onDidChange((menuId) => menuId === VIEW && this.update())];
    this.update();
  }

  /** Shows the button while the menu has entries in the current context, else hides it. */
  update(): void {
    this.#button.hidden = this.menus.items(VIEW, this.options.context()).length === 0;
  }

  dispose(): void {
    for (const subscription of this.#subscriptions) subscription.dispose();
  }
}

export interface ViewMenuOptions {
  /** What the menu is shown for now (`activeEditorId`, `resource`). */
  context(): MenuContext;
  /** Pops up a contributed menu (the window's). */
  showContextMenu(menuId: string, options: ContextMenuOptions): void;
  /** Puts the button into the title bar (once), until disposed. */
  place(button: HTMLElement): Disposable;
}

const VIEW = 'window/view';

/** "View"'s mark that it opens a menu: a chevron pointing down. */
const CHEVRON_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 6.5 8 10l3.5-3.5"/></svg>';
