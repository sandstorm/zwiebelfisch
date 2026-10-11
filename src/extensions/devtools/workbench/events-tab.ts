// The devtools' Events tab. See DevtoolsPanel in devtools-panel.ts.
import type { EventLog, LoggedEvent } from '../recording/event-log';
import { element, type Tab } from './dom';

/**
 * The event log, latest first, each value pretty-printed (long ones folded), filtered by event name, paused and
 * cleared.
 */
export class EventsTab implements Tab {
  readonly element: HTMLElement;
  #query = '';
  /** The events whose folded value is open, kept across redraws. */
  readonly #open = new Set<number>();
  readonly #count: HTMLElement;
  readonly #list: HTMLElement;

  constructor(
    private readonly doc: Document,
    private readonly events: EventLog,
  ) {
    this.element = element(doc, 'div', 'typst-devtools__events');
    const bar = this.element.appendChild(element(doc, 'div', 'typst-devtools__bar'));
    const filter = bar.appendChild(element(doc, 'input', 'typst-devtools__filter'));
    filter.type = 'search';
    filter.placeholder = 'Filter by event name';
    filter.setAttribute('aria-label', 'Filter events by name');
    filter.addEventListener('input', () => {
      this.#query = filter.value;
      this.update();
    });
    const pause = bar.appendChild(element(doc, 'button', 'typst-devtools__button', 'Pause'));
    pause.setAttribute('aria-pressed', 'false');
    pause.title = 'Stop logging events, to read the log as it is';
    pause.addEventListener('click', () => {
      events.paused = !events.paused;
      pause.setAttribute('aria-pressed', String(events.paused));
      this.update();
    });
    const clear = bar.appendChild(element(doc, 'button', 'typst-devtools__button', 'Clear'));
    clear.addEventListener('click', () => {
      events.clear();
      this.#open.clear();
      this.update();
    });
    this.#count = this.element.appendChild(element(doc, 'p', 'typst-devtools__note'));
    this.#list = this.element.appendChild(element(doc, 'ol', 'typst-devtools__list'));
  }

  update(): void {
    const shown = this.events.filtered(this.#query);
    const total = this.events.entries.length;
    const counted = shown.length === total ? `${total} events` : `${shown.length} of ${total} events`;
    this.#count.textContent = `${counted}, latest first${this.events.paused ? ' · paused' : ''}`;
    this.#list.replaceChildren(...[...shown].reverse().map((entry) => this.#entry(entry)));
  }

  #entry(entry: LoggedEvent): HTMLElement {
    const item = element(this.doc, 'li', 'typst-devtools__event');
    const time = new Date(entry.time);
    const clock = `${time.toTimeString().slice(0, 8)}.${String(time.getMilliseconds()).padStart(3, '0')}`;
    const head = item.appendChild(element(this.doc, 'div', 'typst-devtools__head'));
    head.append(element(this.doc, 'span', 'typst-devtools__time', clock), element(this.doc, 'span', 'typst-devtools__point', entry.event));
    item.append(this.#value(entry));
    item.title = `${entry.event} at ${clock}\n\n${entry.value.text}`;
    return item;
  }

  /** The value: in place if short, else folded with its first line as the summary. */
  #value(entry: LoggedEvent): HTMLElement {
    const { line, text } = entry.value;
    if (text.split('\n').length <= FOLD_LINES) return element(this.doc, 'pre', 'typst-devtools__value', text);
    const details = element(this.doc, 'details', 'typst-devtools__fold');
    details.open = this.#open.has(entry.id);
    details.addEventListener('toggle', () => (details.open ? this.#open.add(entry.id) : this.#open.delete(entry.id)));
    details.append(element(this.doc, 'summary', 'typst-devtools__value', line), element(this.doc, 'pre', 'typst-devtools__value', text));
    return details;
  }
}

/** Values of more lines than this are folded (`<details>`), their first line shown. */
const FOLD_LINES = 6;
