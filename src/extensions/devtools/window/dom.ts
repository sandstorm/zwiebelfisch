// What the devtools' panel and its tabs share: a tab's shape, making elements. See DevtoolsPanel in devtools-panel.ts.

/** A tab's content: its element, kept while the tab is shown (with its inputs and what is expanded), and `update`, redrawing it. */
export interface Tab {
  readonly element: HTMLElement;
  update(): void;
}

export function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const created = doc.createElement(tag);
  if (className) created.className = className;
  if (text !== undefined) created.textContent = text;
  return created;
}
