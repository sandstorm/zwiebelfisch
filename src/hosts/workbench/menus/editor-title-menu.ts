// EditorTitleMenu: the `editor/title` menu (VS Code's id) as a toolbar at the end of the editing area's tab bar.
// See workbench.ts (`registerMenuItem`) and docs/30_architecture/07_workbench.typ.
import type { Disposable } from '../../../core/disposable/disposable';
import type { MenuContext } from '../workbench';
import type { Menus } from './menus';

const EDITOR_TITLE = 'editor/title';

export interface EditorTitleMenuOptions {
  /** What the menu is shown for now (`editorMode`, `resource`), asked on every `update`. */
  context(): MenuContext;
  /** Runs an entry's command (without arguments). */
  executeCommand(command: string): Promise<unknown>;
}

/**
 * A button per entry of `editor/title` whose `when` holds, in the menus' order, with its icon and title. Shown again on
 * `update` (the tab or the file changed) and whenever the menu's entries change. Pressing a button keeps the focus
 * where it is: the commands act on the editor's selection. A failing command is logged; it tells the user itself.
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
    this.element.className = 'typst-editor__tab-actions';
    this.element.setAttribute('role', 'toolbar');
    this.element.setAttribute('aria-label', 'Editor actions');
    this.element.addEventListener('mousedown', (event) => {
      if ((event.target as Element).closest('button')) event.preventDefault();
    });
    this.#subscription = menus.onDidChange((menuId) => menuId === EDITOR_TITLE && this.update());
  }

  /** Shows the entries that apply in the current context. */
  update(): void {
    this.element.replaceChildren(...this.menus.items(EDITOR_TITLE, this.options.context()).map((item) => this.#button(item.command, item.title, item.icon)));
  }

  dispose(): void {
    this.#subscription.dispose();
    this.element.remove();
  }

  #button(command: string, title = command, icon?: string): HTMLButtonElement {
    const doc = this.element.ownerDocument;
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'typst-editor__tab-action';
    button.dataset.command = command;
    button.title = title;
    if (icon) {
      const iconElement = doc.createElement('span');
      iconElement.className = 'typst-editor__tab-action-icon';
      iconElement.setAttribute('aria-hidden', 'true');
      iconElement.innerHTML = icon;
      button.append(iconElement);
    }
    const text = doc.createElement('span');
    text.textContent = title;
    button.append(text);
    button.addEventListener('click', () => {
      this.options.executeCommand(command).catch((error: unknown) => console.error(`Command ${command} failed:`, error));
    });
    return button;
  }
}
