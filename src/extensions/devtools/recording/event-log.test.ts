// Tests for event-log.ts.
import { describe, expect, it } from 'vitest';
import type { ExtensionContext } from '../../../hosts/workbench/workbench';
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
    listened: () => listeners.size > 0,
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
  it('keeps every event, oldest first, with their values as they were then, until cleared', () => {
    const log = new EventLog();
    const change = { kind: 'update', path: '/x.typ' };
    log.add('a', 1, 10);
    log.add('b', change, 20);
    log.add('c', 'text', 30);
    change.path = '/y.typ';
    for (let i = 0; i < 400; i++) log.add('d', i, 40);
    expect(log.entries).toHaveLength(403);
    expect(log.entries.slice(0, 3).map(({ id, time, event, value }) => [id, time, event, value.text])).toEqual([
      [0, 10, 'a', '1'],
      [1, 20, 'b', '{ kind: "update", path: "/x.typ" }'],
      [2, 30, 'c', '"text"'],
    ]);
    log.clear();
    expect(log.entries).toEqual([]);
  });

  it('filters by event name (words, case ignored); keeps nothing while paused', () => {
    const log = new EventLog();
    log.add('project.onDidChangeFile', {});
    log.add('window.onDidChangeTextEditorSelection', {});
    log.add('window.onDidChangeActiveFile', '/a.typ');
    expect(log.filtered('window file').map((entry) => entry.event)).toEqual(['window.onDidChangeActiveFile']);
    expect(log.filtered('CHANGEFILE').map((entry) => entry.event)).toEqual(['project.onDidChangeFile']);
    expect(log.filtered(' ')).toHaveLength(3);

    log.paused = true;
    expect(log.add('preview.onDidRender', undefined)).toBe(false);
    expect(log.entries).toHaveLength(3);
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

  it("leaves out the window's dropped files: listening would turn on the drop hint", () => {
    const drops = emitter<File[]>();
    const context = { subscriptions: [], window: { onDidDropFiles: drops.event } } as unknown as ExtensionContext;
    subscribeToEvents(context, () => {});
    expect(drops.listened()).toBe(false);
  });
});
