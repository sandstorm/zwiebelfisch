// The devtools' Events tab. See DevtoolsPanel in devtools-panel.ts.
import type { EventLog, LoggedEvent } from '../recording/event-log';
import { element, type Tab } from './dom';

/**
 * The event log, latest first, each value pretty-printed (long ones folded), filtered by event name, paused and
 * cleared. Each entry's row is made once and kept (with what is unfolded in it): the log keeps every event while the
 * panel is shown, and a redraw only adds the new ones' rows.
 */
export class EventsTab implements Tab {
  readonly element: HTMLElement;
  #query = '';
  /** Each entry's row, by its id. */
  readonly #rows = new Map<number, HTMLElement>();
  readonly #count: HTMLElement;
  readonly #list: HTMLElement;

  constructor(
    private readonly doc: Document,
    private readonly events: EventLog,
  ) {
    this.element = element(doc, 'div', 'zwf-devtools__events');
    const bar = this.element.appendChild(element(doc, 'div', 'zwf-devtools__bar'));
    const filter = bar.appendChild(element(doc, 'input', 'zwf-devtools__filter'));
    filter.type = 'search';
    filter.placeholder = 'Filter by event name';
    filter.setAttribute('aria-label', 'Filter events by name');
    filter.addEventListener('input', () => {
      this.#query = filter.value;
      this.update();
    });
    const pause = bar.appendChild(element(doc, 'button', 'zwf-devtools__button', 'Pause'));
    pause.setAttribute('aria-pressed', 'false');
    pause.title = 'Stop logging events, to read the log as it is';
    pause.addEventListener('click', () => {
      events.paused = !events.paused;
      pause.setAttribute('aria-pressed', String(events.paused));
      this.update();
    });
    const clear = bar.appendChild(element(doc, 'button', 'zwf-devtools__button', 'Clear'));
    clear.addEventListener('click', () => {
      events.clear();
      this.#rows.clear();
      this.update();
    });
    this.#count = this.element.appendChild(element(doc, 'p', 'zwf-devtools__note'));
    this.#list = this.element.appendChild(element(doc, 'ol', 'zwf-devtools__list'));
  }

  update(): void {
    const shown = this.events.filtered(this.#query);
    const total = this.events.entries.length;
    const counted = shown.length === total ? `${total} events` : `${shown.length} of ${total} events`;
    this.#count.textContent = `${counted} logged while this panel is shown, latest first${this.events.paused ? ' · paused' : ''}`;
    this.#list.replaceChildren(...[...shown].reverse().map((entry) => this.#row(entry)));
  }

  #row(entry: LoggedEvent): HTMLElement {
    let row = this.#rows.get(entry.id);
    if (!row) this.#rows.set(entry.id, (row = this.#entry(entry)));
    return row;
  }

  #entry(entry: LoggedEvent): HTMLElement {
    const item = element(this.doc, 'li', 'zwf-devtools__event');
    const time = new Date(entry.time);
    const clock = `${time.toTimeString().slice(0, 8)}.${String(time.getMilliseconds()).padStart(3, '0')}`;
    const head = item.appendChild(element(this.doc, 'div', 'zwf-devtools__head'));
    head.append(element(this.doc, 'span', 'zwf-devtools__time', clock), element(this.doc, 'span', 'zwf-devtools__point', entry.event));
    item.append(this.#value(entry));
    item.title = `${entry.event} at ${clock}\n\n${entry.value.text}`;
    return item;
  }

  /** The value: in place if short, else folded with its first line as the summary. */
  #value(entry: LoggedEvent): HTMLElement {
    const { line, text } = entry.value;
    if (text.split('\n').length <= FOLD_LINES) return element(this.doc, 'pre', 'zwf-devtools__value', text);
    const details = element(this.doc, 'details', 'zwf-devtools__fold');
    details.append(element(this.doc, 'summary', 'zwf-devtools__value', line), element(this.doc, 'pre', 'zwf-devtools__value', text));
    return details;
  }
}

/** Values of more lines than this are folded (`<details>`), their first line shown. */
const FOLD_LINES = 6;
