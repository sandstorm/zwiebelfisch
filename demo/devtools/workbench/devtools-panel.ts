// The devtools' side panel: three tabs over the models (the document of the shown file, the contributions, the
// events), each drawn by its own view. It draws what it is given; ../devtools.ts wires it to the extension context.
import type { SourceRange } from '../../../src';
import type { ContributionLog } from '../model/contributions';
import type { EventLog } from '../model/event-log';
import { ContributionsTab } from './contributions-tab';
import { DocumentTab, type ShownDocument } from './document-tab';
import { element, type TabView } from './dom';
import { EventsTab } from './events-tab';

export interface DevtoolsPanelOptions {
  readonly contributions: ContributionLog;
  readonly events: EventLog;
  document(): ShownDocument;
  /** Shows `range` of the shown file in its editor. */
  reveal(range: SourceRange): void;
}

const TABS = [
  { id: 'document', label: 'Document' },
  { id: 'contributions', label: 'Contributions' },
  { id: 'events', label: 'Events' },
] as const;

export type DevtoolsTab = (typeof TABS)[number]['id'];

/** The panel in `body`; `changed(tab)` redraws that tab (once per frame) if it is the one shown. */
export class DevtoolsPanel {
  #tab: DevtoolsTab = 'document';
  #frame = 0;
  readonly #doc: Document;
  readonly #tabs: HTMLElement;
  readonly #content: HTMLElement;
  readonly #views: Record<DevtoolsTab, TabView>;

  constructor(
    private readonly body: HTMLElement,
    options: DevtoolsPanelOptions,
  ) {
    const doc = (this.#doc = body.ownerDocument);
    this.#views = {
      document: new DocumentTab(doc, options.document, options.reveal),
      contributions: new ContributionsTab(doc, options.contributions),
      events: new EventsTab(doc, options.events),
    };
    const root = element(doc, 'div', 'typst-devtools');
    root.dataset.testid = 'typst-devtools';
    this.#tabs = root.appendChild(element(doc, 'div', 'typst-devtools__tabs'));
    this.#tabs.setAttribute('role', 'tablist');
    for (const tab of TABS) {
      const button = this.#tabs.appendChild(element(doc, 'button', 'typst-devtools__tab', tab.label));
      button.setAttribute('role', 'tab');
      button.addEventListener('click', () => this.show(tab.id));
    }
    this.#content = root.appendChild(element(doc, 'div', 'typst-devtools__content'));
    this.#content.setAttribute('role', 'tabpanel');
    body.append(root);
    this.show('document');
  }

  show(tab: DevtoolsTab): void {
    this.#tab = tab;
    TABS.forEach(({ id }, index) => this.#tabs.children[index].setAttribute('aria-selected', String(id === tab)));
    this.#content.replaceChildren(this.#views[tab].element);
    this.#views[tab].update();
  }

  changed(tab: DevtoolsTab): void {
    if (tab !== this.#tab || this.#frame) return;
    const view = this.#doc.defaultView;
    if (!view) return this.#views[tab].update();
    this.#frame = view.requestAnimationFrame(() => {
      this.#frame = 0;
      this.#views[this.#tab].update();
    });
  }

  dispose(): void {
    if (this.#frame) this.#doc.defaultView?.cancelAnimationFrame(this.#frame);
    this.body.replaceChildren();
  }
}
