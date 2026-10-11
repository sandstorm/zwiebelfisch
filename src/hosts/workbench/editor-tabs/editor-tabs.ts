// EditorTabs: the tab bar of the editing area: a tab per editor the shown file can be shown in (Visual / Source for a
// Typst file), and the editor/title menu at its end. See workbench.ts and docs/30_architecture/07_workbench.typ.

/** An editor the shown file can be switched to. */
export interface EditorTab {
  readonly viewType: string;
  readonly displayName: string;
}

/**
 * A tab per editor of the shown file ("open with"), the shown one selected; hidden unless there are several. Choosing
 * another tab asks for the file in that editor (`onDidChoose`).
 */
export class EditorTabs {
  readonly element: HTMLElement;
  readonly #tabs: HTMLElement;

  constructor(
    doc: Document,
    /** The editor/title menu, at the end of the bar. */
    actions: HTMLElement,
    private readonly onDidChoose: (viewType: string) => void,
  ) {
    this.element = doc.createElement('div');
    this.element.className = 'typst-editor__tabs';
    this.#tabs = doc.createElement('div');
    this.#tabs.className = 'typst-editor__tab-list';
    this.#tabs.setAttribute('role', 'tablist');
    this.element.append(this.#tabs, actions);
    this.#tabs.addEventListener('click', (event) => {
      const tab = (event.target as HTMLElement).closest<HTMLElement>('[role=tab]');
      if (tab?.dataset.viewType && tab.getAttribute('aria-selected') !== 'true') this.onDidChoose(tab.dataset.viewType);
    });
  }

  /** Shows a tab per editor in `editors`, `shown` selected; hides the bar unless there are several. */
  update(editors: readonly EditorTab[], shown: string | undefined): void {
    const doc = this.element.ownerDocument;
    this.element.hidden = editors.length < 2;
    this.#tabs.replaceChildren(
      ...editors.map(({ viewType, displayName }) => {
        const tab = doc.createElement('button');
        tab.type = 'button';
        tab.className = 'typst-editor__tab';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(viewType === shown));
        tab.dataset.viewType = viewType;
        tab.textContent = displayName;
        return tab;
      }),
    );
  }

  dispose(): void {
    this.element.remove();
  }
}
