// Tests for event-log.ts.
import { describe, expect, it } from 'vitest';
import type { ExtensionContext } from '../../../src';
import { EventLog, subscribeToEvents } from './event-log';

/** An event and its firing, in the shape of the package's EventEmitter. */
function emitter<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    event: (listener: (value: T) => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
    fire: (value: T) => listeners.forEach((listener) => listener(value)),
  };
}

class Window {
  readonly #changed = emitter<string>();
  readonly onDidChangeActiveFile = this.#changed.event;

  show(path: string): void {
    this.#changed.fire(path);
  }

  /** Not an event: takes an object first. */
  onDidChangeGrammar(_schema: object, _listener: () => void) {
    throw new Error('not an event');
  }
}

describe('EventLog', () => {
  it('keeps the latest `capacity` events, oldest first, with their values in one line', () => {
    const log = new EventLog(2);
    log.add('a', 1, 10);
    log.add('b', { path: '/x.typ' }, 20);
    log.add('c', 'text', 30);
    expect(log.entries).toEqual([
      { time: 20, event: 'b', value: '{ path: "/x.typ" }' },
      { time: 30, event: 'c', value: '"text"' },
    ]);
    log.clear();
    expect(log.entries).toEqual([]);
  });
});

describe('subscribeToEvents', () => {
  it("hears every onDid… event of the context's members, own or inherited, until disposed", () => {
    const window = new Window();
    const file = emitter<{ kind: string }>();
    const context = { subscriptions: [], window, project: { onDidChangeFile: file.event } } as unknown as ExtensionContext;
    const heard: [string, unknown][] = [];
    const subscription = subscribeToEvents(context, (event, value) => heard.push([event, value]));

    window.show('/a.typ');
    file.fire({ kind: 'update' });
    subscription.dispose();
    window.show('/b.typ');

    expect(heard).toEqual([
      ['window.onDidChangeActiveFile', '/a.typ'],
      ['project.onDidChangeFile', { kind: 'update' }],
    ]);
  });
});
