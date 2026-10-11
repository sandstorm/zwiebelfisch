// The devtools' side panel: three tabs over the models (the projection of the shown file, the contributions by
// extension, the events). It draws what it is given; ../devtools.ts wires it to the extension context.
import type { SourceRange } from '../../../src';
import type { ContributionLog } from '../model/contributions';
import type { EventLog, LoggedEvent } from '../model/event-log';
import type { ProjectionRow } from '../model/projection-tree';

/** The projection of the shown file: its rows and the selection (positions), or why there are none. */
export type ShownProjection =
  | { readonly kind: 'rows'; readonly path: string; readonly rows: readonly ProjectionRow[]; readonly selection: { from: number; to: number }; source(range: SourceRange): string }
  | { readonly kind: 'none'; readonly path: string; readonly reason: string };

export interface DevtoolsPanelOptions {
  readonly contributions: ContributionLog;
  readonly events: EventLog;
  projection(): ShownProjection;
  /** Shows `range` of the shown file in its editor. */
  reveal(range: SourceRange): void;
}

const TABS = [
  { id: 'projection', label: 'Projection' },
  { id: 'contributions', label: 'Contributions' },
  { id: 'events', label: 'Events' },
] as const;

export type DevtoolsTab = (typeof TABS)[number]['id'];

/** The panel in `body`; `changed(tab)` redraws that tab (once per frame) if it is the one shown. */
export class DevtoolsPanel {
  #tab: DevtoolsTab = 'projection';
  #frame = 0;
  readonly #doc: Document;
  readonly #tabs: HTMLElement;
  readonly #content: HTMLElement;

  constructor(
    private readonly body: HTMLElement,
    private readonly options: DevtoolsPanelOptions,
  ) {
    this.#doc = body.ownerDocument;
    const root = element(this.#doc, 'div', 'typst-devtools');
    root.dataset.testid = 'typst-devtools';
    this.#tabs = root.appendChild(element(this.#doc, 'div', 'typst-devtools__tabs'));
    this.#tabs.setAttribute('role', 'tablist');
    for (const tab of TABS) {
      const button = this.#tabs.appendChild(element(this.#doc, 'button', 'typst-devtools__tab', tab.label));
      button.setAttribute('role', 'tab');
      button.addEventListener('click', () => this.show(tab.id));
    }
    this.#content = root.appendChild(element(this.#doc, 'div', 'typst-devtools__content'));
    this.#content.setAttribute('role', 'tabpanel');
    body.append(root);
    this.show('projection');
  }

  show(tab: DevtoolsTab): void {
    this.#tab = tab;
    TABS.forEach(({ id }, index) => this.#tabs.children[index].setAttribute('aria-selected', String(id === tab)));
    this.#render();
  }

  changed(tab: DevtoolsTab): void {
    if (tab !== this.#tab || this.#frame) return;
    const view = this.#doc.defaultView;
    if (!view) return this.#render();
    this.#frame = view.requestAnimationFrame(() => {
      this.#frame = 0;
      this.#render();
    });
  }

  dispose(): void {
    if (this.#frame) this.#doc.defaultView?.cancelAnimationFrame(this.#frame);
    this.body.replaceChildren();
  }

  #render(): void {
    const draw = { projection: () => this.#projection(), contributions: () => this.#contributions(), events: () => this.#events() }[this.#tab];
    this.#content.replaceChildren(...draw());
  }

  #projection(): Node[] {
    const shown = this.options.projection();
    const header = element(this.#doc, 'p', 'typst-devtools__note', shown.path);
    if (shown.kind === 'none') return [header, element(this.#doc, 'p', 'typst-devtools__note', shown.reason)];
    const list = element(this.#doc, 'ol', 'typst-devtools__tree');
    for (const row of shown.rows) list.append(this.#projectionRow(row, shown));
    header.append(` · selection ${shown.selection.from}–${shown.selection.to} · ${shown.rows.length} nodes`);
    return [header, list];
  }

  #projectionRow(row: ProjectionRow, shown: Extract<ShownProjection, { kind: 'rows' }>): HTMLElement {
    const item = element(this.#doc, 'li', 'typst-devtools__row');
    const { from, to } = shown.selection;
    if (row.pos <= from && to <= row.end) item.classList.add('typst-devtools__row--selected');
    const button = item.appendChild(element(this.#doc, 'button', 'typst-devtools__node'));
    button.style.paddingInlineStart = `${4 + row.depth * 12}px`;
    button.append(
      element(this.#doc, 'span', 'typst-devtools__name', row.name),
      element(this.#doc, 'span', 'typst-devtools__range', `${row.range.from}–${row.range.to}`),
      ...(row.box ? [element(this.#doc, 'span', 'typst-devtools__badge', 'box')] : []),
      ...row.marks.map((mark) => element(this.#doc, 'span', 'typst-devtools__mark', mark)),
      element(this.#doc, 'span', 'typst-devtools__detail', row.detail),
    );
    button.title = [`pos ${row.pos}–${row.end}`, row.attributes, `source: ${shown.source(row.range)}`].filter(Boolean).join('\n');
    button.addEventListener('click', () => this.options.reveal(row.range));
    return item;
  }

  #contributions(): Node[] {
    return [...this.options.contributions.byExtension()].map(([extension, entries]) => {
      const details = element(this.#doc, 'details', 'typst-devtools__extension');
      details.open = true;
      const summary = details.appendChild(element(this.#doc, 'summary', '', extension));
      summary.append(element(this.#doc, 'span', 'typst-devtools__count', ` ${entries.length}`));
      const list = details.appendChild(element(this.#doc, 'ul', 'typst-devtools__list'));
      for (const entry of entries) {
        const item = list.appendChild(element(this.#doc, 'li', 'typst-devtools__entry'));
        item.append(element(this.#doc, 'span', 'typst-devtools__point', entry.point), element(this.#doc, 'span', 'typst-devtools__detail', entry.label));
      }
      return details;
    });
  }

  #events(): Node[] {
    const { events } = this.options;
    const bar = element(this.#doc, 'p', 'typst-devtools__note', `${events.entries.length} events, latest first `);
    const clear = bar.appendChild(element(this.#doc, 'button', 'typst-devtools__button', 'Clear'));
    clear.addEventListener('click', () => {
      events.clear();
      this.#render();
    });
    const list = element(this.#doc, 'ol', 'typst-devtools__list');
    for (const entry of [...events.entries].reverse()) list.append(this.#event(entry));
    return [bar, list];
  }

  #event(entry: LoggedEvent): HTMLElement {
    const item = element(this.#doc, 'li', 'typst-devtools__entry');
    const time = new Date(entry.time);
    const clock = `${time.toTimeString().slice(0, 8)}.${String(time.getMilliseconds()).padStart(3, '0')}`;
    item.append(
      element(this.#doc, 'span', 'typst-devtools__time', clock),
      element(this.#doc, 'span', 'typst-devtools__point', entry.event),
      element(this.#doc, 'span', 'typst-devtools__detail', entry.value),
    );
    return item;
  }
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const created = doc.createElement(tag);
  if (className) created.className = className;
  if (text !== undefined) created.textContent = text;
  return created;
}
