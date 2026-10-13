// The help panel's view. See help in ../help.ts.
import type { HelpLink, HelpRow, HelpSheet } from '../../../hosts/languages/languages';
import type { MenuAnchor } from '../../../hosts/window/window';

/**
 * The help sheets as lists to pick from: a heading per sheet, a list (`listbox`) per section, a row (`option`) per
 * snippet, the sheet's links below. One row is selected at a time (a click, ↑ / ↓, Home / End: the focus follows) and
 * shows its whole snippet; the others show it on one line, cut. Enter inserts the selected row, a right click, Shift+F10 or
 * the context menu key shows its menu; a row dragged carries the text it inserts as each of the drag types given.
 *
 * Why the rows are one tab stop: the panel is read as one list of many entries, walked with the arrow keys.
 */
export class HelpPanel {
  readonly #root: HTMLElement;
  #rows: { readonly element: HTMLElement; readonly row: HelpRow }[] = [];
  #selected = -1;
  #dragTypes: readonly string[] = [];

  constructor(
    parent: HTMLElement,
    private readonly options: HelpPanelOptions,
  ) {
    const doc = parent.ownerDocument;
    this.#root = doc.createElement('div');
    this.#root.className = 'zwf-help';
    this.#root.dataset.testid = 'zwf-help';
    parent.append(this.#root);
    this.#root.addEventListener('click', (event) => this.#select(this.#indexOf(event.target)));
    this.#root.addEventListener('keydown', (event) => this.#keydown(event));
    this.#root.addEventListener('contextmenu', (event) => this.#contextMenu(event));
    this.#root.addEventListener('dragstart', (event) => this.#dragstart(event));
  }

  /**
   * Shows `sheets` ("No help for this file type" without any), nothing selected. A row dragged carries what it inserts
   * as each of `dragTypes` (`text/plain`, which every text editor takes, and more).
   */
  render(sheets: readonly HelpSheet[], dragTypes: readonly string[]): void {
    const doc = this.#root.ownerDocument;
    this.#dragTypes = dragTypes;
    this.#rows = [];
    this.#selected = -1;
    this.#root.replaceChildren();
    if (sheets.length === 0) this.#root.append(element(doc, 'p', 'zwf-help__empty', 'No help for this file type.'));
    for (const sheet of sheets) this.#root.append(...this.#sheet(doc, sheet));
    this.#rows[0]?.element.setAttribute('tabindex', '0');
  }

  #sheet(doc: Document, { title, sections, links = [] }: HelpSheet): HTMLElement[] {
    const parts: HTMLElement[] = [element(doc, 'h2', 'zwf-help__title', title)];
    for (const section of sections) {
      const part = element(doc, 'section', 'zwf-help__section');
      const heading = part.appendChild(element(doc, 'h3', 'zwf-help__heading', section.title));
      heading.id = `zwf-help-${Math.random().toString(36).slice(2, 10)}`;
      const list = part.appendChild(element(doc, 'ul', 'zwf-help__rows'));
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-labelledby', heading.id);
      for (const row of section.rows) list.append(this.#row(doc, row));
      parts.push(part);
    }
    const shown = links.filter((link) => /^https?:\/\//.test(link.href));
    if (shown.length > 0) parts.push(linkList(doc, shown));
    return parts;
  }

  #row(doc: Document, row: HelpRow): HTMLElement {
    const item = element(doc, 'li', 'zwf-help__row');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    item.tabIndex = -1;
    item.draggable = true;
    item.append(element(doc, 'code', 'zwf-help__snippet', row.snippet), element(doc, 'span', 'zwf-help__description', row.description));
    this.#rows.push({ element: item, row });
    return item;
  }

  #indexOf(target: EventTarget | null): number {
    const item = target instanceof Element ? target.closest('.zwf-help__row') : null;
    return this.#rows.findIndex(({ element }) => element === item);
  }

  /** Selects row `index` (none: -1 leaves it as it is) and focuses it. */
  #select(index: number): void {
    if (index < 0) return;
    for (const [at, { element }] of this.#rows.entries()) {
      element.setAttribute('aria-selected', String(at === index));
      element.tabIndex = at === index ? 0 : -1;
    }
    this.#selected = index;
    this.#rows[index].element.focus();
  }

  #keydown(event: KeyboardEvent): void {
    const index = this.#indexOf(event.target);
    if (index < 0) return;
    const moves: Record<string, number> = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: this.#rows.length - 1 };
    const { row, element } = this.#rows[index];
    if (event.key in moves) this.#select(Math.min(Math.max(moves[event.key], 0), this.#rows.length - 1));
    else if (event.key === 'Enter') this.options.insert(text(row));
    else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) this.#showMenu(index, element);
    else return;
    event.preventDefault();
  }

  #contextMenu(event: MouseEvent): void {
    const index = this.#indexOf(event.target);
    if (index < 0) return;
    event.preventDefault();
    this.#showMenu(index, { x: event.clientX, y: event.clientY });
  }

  #showMenu(index: number, anchor: MenuAnchor): void {
    if (index !== this.#selected) this.#select(index);
    const { row } = this.#rows[index];
    this.options.showContextMenu(text(row), anchor, row.snippet);
  }

  #dragstart(event: DragEvent): void {
    const index = this.#indexOf(event.target);
    if (index < 0 || !event.dataTransfer) return;
    for (const type of this.#dragTypes) event.dataTransfer.setData(type, text(this.#rows[index].row));
    event.dataTransfer.effectAllowed = 'copy';
  }
}

export interface HelpPanelOptions {
  /** Inserts `text` (Enter on a row) at the cursor of the shown editor. */
  insert(text: string): void;
  /** Shows the menu of a row (inserting `text`) at `anchor`, named `title`. */
  showContextMenu(text: string, anchor: MenuAnchor, title: string): void;
}

/** What inserting `row` puts into the text. */
function text(row: HelpRow): string {
  return row.insert ?? row.snippet;
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, content?: string): HTMLElementTagNameMap[K] {
  const result = doc.createElement(tag);
  result.className = className;
  if (content !== undefined) result.textContent = content;
  return result;
}

/** The links of a sheet, each opening in a new tab. */
function linkList(doc: Document, links: readonly HelpLink[]): HTMLElement {
  const list = element(doc, 'ul', 'zwf-help__links');
  for (const { label, href } of links) {
    const anchor = element(doc, 'a', 'zwf-help__link', label);
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    list.appendChild(element(doc, 'li', 'zwf-help__links-item')).append(anchor);
  }
  return list;
}
