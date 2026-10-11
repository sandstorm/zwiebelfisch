// The events of an extension context as they fire, the latest few hundred. See ../devtools.ts.
import type { Event, ExtensionContext } from '../../../src';
import { describeValue } from './describe';

/** One event that fired: when (ms since the epoch), which (`window.onDidChangeActiveFile`), and its value in one line. */
export interface LoggedEvent {
  readonly time: number;
  readonly event: string;
  readonly value: string;
}

/** The last `capacity` events, oldest first. */
export class EventLog {
  #entries: LoggedEvent[] = [];

  constructor(private readonly capacity = 300) {}

  add(event: string, value: unknown, time = Date.now()): void {
    this.#entries.push({ time, event, value: describeValue(value) });
    if (this.#entries.length > this.capacity) this.#entries = this.#entries.slice(-this.capacity);
  }

  get entries(): readonly LoggedEvent[] {
    return this.#entries;
  }

  clear(): void {
    this.#entries = [];
  }
}

/**
 * Subscribes `listener` to every event of `context`: each `onDid…` member of its namespaces and objects (`project`,
 * `window`, `preview`, …), own or inherited. Disposing the result unsubscribes all of them.
 */
export function subscribeToEvents(context: ExtensionContext, listener: (event: string, value: unknown) => void): { dispose(): void } {
  const subscriptions = Object.entries(context).flatMap(([name, namespace]) =>
    eventNames(namespace).map((key) => {
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
