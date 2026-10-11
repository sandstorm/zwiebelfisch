// The devtools' Contributions tab. See devtools-panel.ts.
import type { Contribution, ContributionLog } from '../recording/contributions';
import { element, type Tab } from './dom';

/**
 * Every contribution in its point's terms, grouped by extension or by contribution point (who competes there, in the
 * order the host resolves them).
 */
export class ContributionsTab implements Tab {
  readonly element: HTMLElement;
  #grouping: Grouping = 'extension';
  /** The groups folded (by grouping and name), kept across redraws. */
  readonly #closed = new Set<string>();
  readonly #buttons: HTMLButtonElement[];
  readonly #groups: HTMLElement;

  constructor(
    private readonly doc: Document,
    private readonly contributions: ContributionLog,
  ) {
    this.element = element(doc, 'div', 'typst-devtools__contributions');
    const bar = this.element.appendChild(element(doc, 'div', 'typst-devtools__bar'));
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Group contributions');
    this.#buttons = GROUPINGS.map(({ id, label, title }) => {
      const button = bar.appendChild(element(doc, 'button', 'typst-devtools__button', label));
      button.title = title;
      button.addEventListener('click', () => {
        this.#grouping = id;
        this.update();
      });
      return button;
    });
    const legend = bar.appendChild(element(doc, 'span', 'typst-devtools__legend'));
    legend.append(element(doc, 'span', 'typst-devtools__badge', 'late'), ' after activation · ', element(doc, 'del', '', 'disposed'));
    this.#groups = this.element.appendChild(element(doc, 'div', ''));
  }

  update(): void {
    GROUPINGS.forEach(({ id }, index) => this.#buttons[index].setAttribute('aria-pressed', String(id === this.#grouping)));
    const groups = this.#grouping === 'extension' ? this.contributions.byExtension() : this.contributions.byPoint();
    this.#groups.replaceChildren(...[...groups].map(([name, entries]) => this.#group(name, entries)));
  }

  #group(name: string, entries: readonly Contribution[]): HTMLElement {
    const key = `${this.#grouping}:${name}`;
    const details = element(this.doc, 'details', 'typst-devtools__group');
    details.open = !this.#closed.has(key);
    details.addEventListener('toggle', () => (details.open ? this.#closed.delete(key) : this.#closed.add(key)));
    const summary = details.appendChild(element(this.doc, 'summary', '', name));
    summary.append(element(this.doc, 'span', 'typst-devtools__count', ` ${entries.length}`));
    const list = details.appendChild(element(this.doc, 'ol', 'typst-devtools__list'));
    list.append(...entries.map((entry) => this.#row(entry)));
    return details;
  }

  /** A contribution: its point (or, by point, its extension), what it is, its facts; the tooltip has the rest. */
  #row(entry: Contribution): HTMLElement {
    const item = element(this.doc, 'li', 'typst-devtools__contribution');
    if (entry.disposed) item.classList.add('typst-devtools__contribution--disposed');
    const by = this.#grouping === 'extension' ? entry.point : entry.extension;
    item.append(element(this.doc, 'span', 'typst-devtools__point', by), element(this.doc, 'span', 'typst-devtools__title', entry.title));
    for (const detail of entry.details) item.append(element(this.doc, 'span', 'typst-devtools__fact', detail));
    if (entry.late) item.append(element(this.doc, 'span', 'typst-devtools__badge', 'late'));
    item.title = [
      `${entry.point}: ${entry.title}`,
      `by ${entry.extension}${entry.location ? `, registered at ${entry.location}` : ''}`,
      ...(entry.late ? ['registered after activation'] : []),
      ...(entry.disposed ? ['disposed'] : []),
      '',
      entry.arguments,
    ].join('\n');
    return item;
  }
}

type Grouping = 'extension' | 'point';

const GROUPINGS: readonly { readonly id: Grouping; readonly label: string; readonly title: string }[] = [
  { id: 'extension', label: 'By extension', title: 'Each extension with what it contributes, in activation and registration order' },
  { id: 'point', label: 'By contribution point', title: 'Each contribution point with the contributions competing there, in the order the host resolves them' },
];
