// The devtools' line about the Typst engine's memory, above the tabs. See DevtoolsPanel in devtools-panel.ts.
import { megabytes, type EngineMemoryLog, type MemoryChange } from '../model/engine-memory';
import { element } from './dom';

/** The summary in one line; opened, the latest changes, newest first, each with when and by how much. */
export class MemoryLine {
  readonly element: HTMLDetailsElement;
  readonly #summary: HTMLElement;
  readonly #list: HTMLElement;

  constructor(
    private readonly doc: Document,
    private readonly memory: EngineMemoryLog,
  ) {
    this.element = element(doc, 'details', 'zwf-devtools__memory');
    this.element.dataset.testid = 'zwf-devtools-memory';
    this.#summary = this.element.appendChild(element(doc, 'summary', ''));
    this.element.title = 'Grows while the engine needs more (its caches, the document) and never shrinks; at 4 GB the engine crashes and the preview starts a new one.';
    this.#list = this.element.appendChild(element(doc, 'ol', 'zwf-devtools__list'));
    this.update();
  }

  update(): void {
    this.#summary.textContent = this.memory.summary();
    this.#list.replaceChildren(...[...this.memory.changes].reverse().map((change) => this.#change(change)));
  }

  #change({ time, bytes, growth }: MemoryChange): HTMLElement {
    const item = element(this.doc, 'li', 'zwf-devtools__head');
    const sign = growth < 0 ? '−' : '+';
    item.append(
      element(this.doc, 'span', 'zwf-devtools__time', new Date(time).toTimeString().slice(0, 8)),
      element(this.doc, 'span', '', megabytes(bytes)),
      element(this.doc, 'span', 'zwf-devtools__fact', `${sign}${megabytes(Math.abs(growth))}`),
    );
    return item;
  }
}
