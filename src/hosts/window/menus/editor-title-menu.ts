// EditorTitleMenu: the `window/editorTitle` menu (VS Code's id) and the "View" menu at the end of the editing area's tab bar.
// See registerMenuItem in ../window.ts.
import type { Disposable } from '../../../core/disposable/disposable';
import type { CommandsHost } from '../../commands/commands';
import type { ContextMenuOptions } from '../window';
import type { MenuContext } from '../../commands/commands';
import type { Menus } from './menus';

/**
 * A button per entry of `window/editorTitle` whose `when` holds, in the menus' order, with its icon and title; then "View",
 * which pops up the menu `window/view` below it while that has entries (how the editors and the preview show things). Shown
 * again on `update` (the tab or the file changed) and whenever either menu's entries change. Pressing a button keeps
 * the focus where it is, so the commands act on the editor's selection. A failing command is logged.
 *
 * @internal Extensions add to it through `window.registerMenuItem` (`window/editorTitle`, `window/view`).
 */
export class EditorTitleMenu {
  readonly element: HTMLElement;
  readonly #subscription: Disposable;

  constructor(
    doc: Document,
    private readonly menus: Menus,
    private readonly options: EditorTitleMenuOptions,
  ) {
    this.element = doc.createElement('div');
    this.element.className = 'zwf-editor__tab-actions';
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-label', 'Editor actions');
    this.element.addEventListener('mousedown', (event) => {
      if ((event.target as Element).closest('button')) event.preventDefault();
    });
    this.#subscription = menus.onDidChange((menuId) => (menuId === EDITOR_TITLE || menuId === VIEW) && this.update());
  }

  /** Shows the entries that apply in the current context; tells `onDidUpdate`. */
  update(): void {
    const context = this.options.context();
    const buttons = this.menus.items(EDITOR_TITLE, context).map((item) => this.#button(item.command, item.title, item.icon));
    if (this.menus.items(VIEW, context).length > 0) buttons.push(this.#viewButton());
    this.element.replaceChildren(...buttons);
    this.options.onDidUpdate();
  }

  dispose(): void {
    this.#subscription.dispose();
    this.element.remove();
  }

  #button(command: string, title = command, icon?: string): HTMLButtonElement {
    const button = this.#makeButton(title, icon);
    const key = this.options.commands.keybindingLabel(command);
    if (key) button.title = `${title} (${key})`;
    button.dataset.command = command;
    button.addEventListener('click', () => {
      this.options.commands.executeCommand(command).catch((error: unknown) => console.error(`Command ${command} failed:`, error));
    });
    return button;
  }

  #viewButton(): HTMLButtonElement {
    const button = this.#makeButton('View');
    button.classList.add('zwf-editor__view-menu');
    button.setAttribute('aria-haspopup', 'menu');
    const chevron = this.element.ownerDocument.createElement('span');
    chevron.className = 'zwf-editor__tab-action-icon';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = CHEVRON_ICON;
    button.append(chevron);
    button.addEventListener('click', () => this.options.showContextMenu(VIEW, { anchor: button, title: 'View', context: this.options.context() }));
    return button;
  }

  #makeButton(title: string, icon?: string): HTMLButtonElement {
    const doc = this.element.ownerDocument;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'zwf-editor__tab-action';
    button.title = title;
    if (icon) {
      const iconElement = doc.createElement('span');
      iconElement.className = 'zwf-editor__tab-action-icon';
      iconElement.setAttribute('aria-hidden', 'true');
      iconElement.innerHTML = icon;
      button.append(iconElement);
    }
    const text = doc.createElement('span');
    text.textContent = title;
    button.append(text);
    return button;
  }
}

export interface EditorTitleMenuOptions {
  /** What the menus are shown for now (`activeEditorId`, `resource`), asked on every `update` and for "View". */
  context(): MenuContext;
  /** Runs an entry's command (without arguments); names its key in the button's tooltip. */
  readonly commands: Pick<CommandsHost, 'executeCommand' | 'keybindingLabel'>;
  /** Pops up a contributed menu (the window's). */
  showContextMenu(menuId: string, options: ContextMenuOptions): void;
  /** The buttons were shown anew (the tab bar shows itself while it has tabs or buttons). */
  onDidUpdate(): void;
}

const EDITOR_TITLE = 'window/editorTitle';
const VIEW = 'window/view';

/** "View"'s mark that it opens a menu: a chevron pointing down. */
const CHEVRON_ICON =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 6.5 8 10l3.5-3.5"/></svg>';
