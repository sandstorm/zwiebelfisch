// See WorkbenchHost in ../workbench-impl.ts.
import { EditorTitleMenu, type EditorTitleMenuOptions } from '../menus/editor-title-menu';
import type { Menus } from '../menus/menus';

/**
 * The tab bar of the editing area: a tab per editor the shown file can be shown in ("open with"; Visual / Source for
 * a Typst file), the shown one selected, and at its end the editor/title menu and "View" (`EditorTitleMenu`). The tabs
 * show while the file has several editors, the bar while it has tabs or buttons. Choosing another tab asks for the
 * file in that editor (`onDidChoose`).
 */
export class EditorTabs {
  readonly #element: HTMLElement;
  readonly #tabs: HTMLElement;
  readonly #actions: EditorTitleMenu;

  /** Appends the bar to `container` (the editing area). */
  constructor(container: HTMLElement, menus: Menus, options: EditorTabsOptions) {
    const doc = container.ownerDocument;
    this.#element = doc.createElement('div');
    this.#element.className = 'zwf-editor__tabs';
    this.#tabs = doc.createElement('div');
    this.#tabs.className = 'zwf-editor__tab-list';
    this.#tabs.setAttribute('role', 'tablist');
    this.#actions = new EditorTitleMenu(doc, menus, { ...options, onDidUpdate: () => this.#fit() });
    this.#element.append(this.#tabs, this.#actions.element);
    container.append(this.#element);
    this.#tabs.addEventListener('click', (event) => {
      const tab = (event.target as HTMLElement).closest<HTMLElement>('[role=tab]');
      if (tab?.dataset.viewType && tab.getAttribute('aria-selected') !== 'true') options.onDidChoose(tab.dataset.viewType);
    });
  }

  /** Shows a tab per editor in `editors`, `shown` selected (the tabs hidden unless there are several), and the menus for it. */
  update(editors: readonly EditorTab[], shown: string | undefined): void {
    const doc = this.#element.ownerDocument;
    this.#tabs.hidden = editors.length < 2;
    this.#tabs.replaceChildren(
      ...editors.map(({ viewType, displayName }) => {
        const tab = doc.createElement('button');
        tab.type = 'button';
        tab.className = 'zwf-editor__tab';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(viewType === shown));
        tab.dataset.viewType = viewType;
        tab.textContent = displayName;
        return tab;
      }),
    );
    this.#actions.update();
  }

  dispose(): void {
    this.#actions.dispose();
    this.#element.remove();
  }

  #fit(): void {
    this.#element.hidden = this.#tabs.hidden && this.#actions.element.childElementCount === 0;
  }
}

export interface EditorTabsOptions extends Omit<EditorTitleMenuOptions, 'onDidUpdate'> {
  /** The user chose the tab of another editor (its view type). */
  onDidChoose(viewType: string): void;
}

/** An editor the shown file can be switched to. */
export interface EditorTab {
  readonly viewType: string;
  readonly displayName: string;
}
