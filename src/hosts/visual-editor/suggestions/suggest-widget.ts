// SuggestWidget: the list a completion item provider's items pop up in while its trigger is typed. See
// suggestions.ts.
import type { CompletionItem } from '../visual-editor';

/**
 * A `role="listbox"` of completion items in `container` (positioned by the caller). One option is the chosen one:
 * arrow keys move it, Enter or Tab accept it, a click accepts the clicked one, the mouse pointer chooses what it
 * points at. The editor keeps the focus; its element (`input`) names the chosen option (`aria-activedescendant`)
 * while the list shows.
 *
 * @internal Extensions fill it through `visualEditor.registerCompletionItemProvider`.
 */
export class SuggestWidget {
  readonly element: HTMLElement;
  private items: readonly CompletionItem[] = [];
  private chosen = 0;
  private readonly id = `zwf-suggest-${++widgets}`;

  constructor(
    container: HTMLElement,
    private readonly input: HTMLElement,
    trigger: string,
    private readonly accept: (item: CompletionItem) => void,
  ) {
    this.element = container.appendChild(container.ownerDocument.createElement('div'));
    this.element.className = 'zwf-visual__suggest';
    this.element.id = this.id;
    this.element.dataset.testid = 'zwf-suggest';
    this.element.dataset.trigger = trigger;
    this.element.setAttribute('role', 'listbox');
    this.element.setAttribute('aria-label', 'Suggestions');
    this.element.hidden = true;
    // a click must not move the editor's selection before it is accepted
    this.element.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const index = this.indexAt(event.target);
      if (index !== null) this.accept(this.items[index]);
    });
    this.element.addEventListener('mousemove', (event) => {
      const index = this.indexAt(event.target);
      if (index !== null && index !== this.chosen) this.choose(index);
    });
  }

  /** The chosen item while the list shows. */
  get chosenItem(): CompletionItem | undefined {
    return this.element.hidden ? undefined : this.items[this.chosen];
  }

  /** Shows `items`; `keepChoice` keeps the chosen one where it was (the same query), else the first is chosen. */
  show(items: readonly CompletionItem[], keepChoice: boolean): void {
    this.items = items;
    if (!keepChoice || this.chosen >= items.length) this.chosen = 0;
    this.element.hidden = items.length === 0;
    const doc = this.element.ownerDocument;
    this.element.replaceChildren(...items.map((item, index) => option(doc, item, `${this.id}-${index}`, index)));
    this.input.setAttribute('aria-controls', this.id);
    this.choose(this.chosen);
  }

  hide(): void {
    this.element.hidden = true;
    this.input.removeAttribute('aria-activedescendant');
    this.input.removeAttribute('aria-controls');
  }

  /** Handles a key while the list shows: true if it was the list's (arrows, Enter, Tab). */
  keyDown(event: KeyboardEvent): boolean {
    const item = this.chosenItem;
    if (!item) return false;
    const move = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (move) this.choose((this.chosen + move + this.items.length) % this.items.length);
    else if (event.key === 'Enter' || event.key === 'Tab') this.accept(item);
    else return false;
    return true;
  }

  dispose(): void {
    this.hide();
    this.element.remove();
  }

  private choose(index: number): void {
    this.chosen = index;
    for (const [at, option] of [...this.element.children].entries()) option.setAttribute('aria-selected', String(at === index));
    const chosen = this.element.children[index];
    if (!chosen) return;
    this.input.setAttribute('aria-activedescendant', chosen.id);
    chosen.scrollIntoView?.({ block: 'nearest' });
  }

  private indexAt(target: EventTarget | null): number | null {
    const option = (target as Element | null)?.closest?.<HTMLElement>('[data-index]');
    return option ? Number(option.dataset.index) : null;
  }
}

let widgets = 0;

function option(doc: Document, item: CompletionItem, id: string, index: number): HTMLElement {
  const element = doc.createElement('div');
  element.className = 'zwf-visual__suggest-option';
  element.id = id;
  element.setAttribute('role', 'option');
  element.dataset.index = String(index);
  if (item.icon) {
    const icon = element.appendChild(doc.createElement('span'));
    icon.className = 'zwf-visual__suggest-icon';
    icon.innerHTML = item.icon;
  }
  element.append(Object.assign(doc.createElement('span'), { className: 'zwf-visual__suggest-label', textContent: item.label }));
  if (item.detail) element.append(Object.assign(doc.createElement('span'), { className: 'zwf-visual__suggest-detail', textContent: item.detail }));
  return element;
}
