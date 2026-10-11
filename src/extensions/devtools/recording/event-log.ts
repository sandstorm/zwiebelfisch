// The events of an extension context as they fire, the latest few hundred, with their values pretty-printed. See
// devtools in ../devtools.ts.
import type { Event } from '../../../core/event-emitter/event-emitter';
import type { ExtensionContext } from '../../../hosts/workbench/workbench';
import { formatValue, type FormattedValue } from '../model/describe';

/** The last `capacity` events, oldest first; while `paused`, none are added. */
export class EventLog {
  #entries: LoggedEvent[] = [];
  #next = 0;
  /** While true, `add` keeps nothing: the log stays as it is, to read. */
  paused = false;

  constructor(private readonly capacity = 300) {}

  /** Logs `event` with `value` (formatted now: a value changing later is shown as it was); false while paused. */
  add(event: string, value: unknown, time = Date.now()): boolean {
    if (this.paused) return false;
    this.#entries.push({ id: this.#next++, time, event, value: formatValue(value) });
    if (this.#entries.length > this.capacity) this.#entries = this.#entries.slice(-this.capacity);
    return true;
  }

  get entries(): readonly LoggedEvent[] {
    return this.#entries;
  }

  /** The entries whose event name contains `query` (case ignored; words separated by spaces must all occur). */
  filtered(query: string): readonly LoggedEvent[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return this.#entries;
    return this.#entries.filter((entry) => words.every((word) => entry.event.toLowerCase().includes(word)));
  }

  clear(): void {
    this.#entries = [];
  }
}

/** One event that fired: when (ms since the epoch), which (`window.onDidChangeActiveFile`), and its value as it was then. */
export interface LoggedEvent {
  /** Unique in the log, in firing order. */
  readonly id: number;
  readonly time: number;
  readonly event: string;
  readonly value: FormattedValue;
}

/**
 * Subscribes `listener` to every event of `context`: each `onDid…` member of its namespaces and objects (`project`,
 * `window`, `preview`, …), own or inherited, except `workbench.onDidDropFiles`: listening to it is what turns on the
 * widget's drop hint. Disposing the result unsubscribes all of them.
 */
export function subscribeToEvents(context: ExtensionContext, listener: (event: string, value: unknown) => void): { dispose(): void } {
  const subscriptions = Object.entries(context).flatMap(([name, namespace]) =>
    eventNames(namespace).filter((key) => `${name}.${key}` !== 'workbench.onDidDropFiles').map((key) => {
      const event = Reflect.get(namespace as object, key) as Event<unknown>;
      return event.call(namespace, (value) => listener(`${name}.${key}`, value));
    }),
  );
  return { dispose: () => subscriptions.forEach((subscription) => subscription.dispose()) };
}

/** The `onDid…` members of `value` that are events (functions of the listener alone). */
function eventNames(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  const names = new Set<string>();
  for (let layer: object | null = value; layer && layer !== Object.prototype; layer = Object.getPrototypeOf(layer) as object | null) {
    for (const key of Object.getOwnPropertyNames(layer)) if (key.startsWith('onDid')) names.add(key);
  }
  return [...names].filter((key) => {
    const member: unknown = Reflect.get(value, key);
    return typeof member === 'function' && member.length === 1;
  });
}
