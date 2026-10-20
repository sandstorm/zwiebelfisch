// @vitest-environment jsdom
// Tests for extension-host.ts: activation, the declarations reaching the hosts, the mementos.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { type Extension, type ExtensionContext, ExtensionHost, type ExtensionHostOptions, StorageMemento } from './extension-host';

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

/** Hosts that only take declarations, in a page whose storages keep the mementos. */
function hosts() {
  return {
    project: { main: '/main.typ' },
    commands: { declareKeybindings: vi.fn(), declareCommands: vi.fn() },
    window: { declareCommands: vi.fn(), ownerDocument: document },
    languages: { declare: vi.fn() },
    workspace: { declare: vi.fn(), check: vi.fn() },
  };
}

const shared = hosts() as unknown as ExtensionHostOptions;

function extension(id: string, activate: (context: ExtensionContext) => void): Extension {
  return { id, activate };
}

describe('ExtensionHost', () => {
  it('activates in list order and disposes in reverse, each extension\'s subscriptions in reverse', () => {
    const order: string[] = [];
    const host = new ExtensionHost(shared);
    const logging = (id: string) =>
      extension(id, ({ subscriptions }) => {
        order.push(`activate ${id}`);
        subscriptions.push(new Disposable(() => order.push(`dispose ${id}.1`)), new Disposable(() => order.push(`dispose ${id}.2`)));
      });
    host.activate([logging('a'), logging('b')]);
    host.dispose();
    expect(order).toEqual(['activate a', 'activate b', 'dispose b.2', 'dispose b.1', 'dispose a.2', 'dispose a.1']);
  });

  it('also disposes what an extension registered after activation (e.g. once connected)', () => {
    let later: ExtensionContext['subscriptions'] = [];
    let disposed = false;
    const host = new ExtensionHost(shared);
    host.activate([extension('a', ({ subscriptions }) => (later = subscriptions))]);
    later.push(new Disposable(() => (disposed = true)));
    host.dispose();
    expect(disposed).toBe(true);
  });

  it('refuses an extension listed twice', () => {
    expect(() => new ExtensionHost(shared).activate([extension('a', () => {}), extension('a', () => {})])).toThrow(/twice/);
  });

  it('declares every extension\'s contributions before activating the first, then checks the settings', () => {
    const fake = hosts();
    const properties = { 'a.on': { type: 'boolean', default: true, description: 'On' } } as const;
    const declared = { configuration: { properties }, languages: [{ id: 'x', extensions: ['.x'] }], commands: [{ command: 'b.run', title: 'Run' }], keybindings: [{ command: 'b.run', key: 'Mod+KeyR' }] };
    const seen: number[] = [];
    const host = new ExtensionHost(fake as unknown as ExtensionHostOptions);
    host.activate([extension('a', () => seen.push(fake.workspace.check.mock.calls.length)), { id: 'b', contributes: declared, activate: () => {} }]);
    expect(seen).toEqual([1]);
    expect(fake.workspace.declare).toHaveBeenLastCalledWith(properties);
    expect(fake.languages.declare).toHaveBeenLastCalledWith(declared.languages);
    expect(fake.commands.declareKeybindings).toHaveBeenLastCalledWith(declared.keybindings);
    expect(fake.commands.declareCommands).toHaveBeenLastCalledWith(declared.commands);
    expect(fake.window.declareCommands).toHaveBeenLastCalledWith(declared.commands);
  });

  it('gives each extension its own globalState (local storage) and workspaceState (session storage, by main file)', async () => {
    const states: Record<string, ExtensionContext> = {};
    new ExtensionHost(shared).activate(['a', 'b'].map((id) => extension(id, (context) => (states[id] = context))));
    await states.a.globalState.update('k', 1);
    await states.a.workspaceState.update('k', 2);
    expect(states.b.globalState.get('k')).toBeUndefined();
    expect(localStorage.getItem('zwf:global:a:k')).toBe('1');
    expect(sessionStorage.getItem('zwf:/main.typ:a:k')).toBe('2');
  });
});

describe('StorageMemento', () => {
  it('keeps values as JSON under its prefix, apart from other prefixes', async () => {
    const memento = StorageMemento.of(document, 'sessionStorage', 'widget:files:');
    expect(memento.get('folders')).toBeUndefined();
    expect(memento.get('folders', [])).toEqual([]);
    await memento.update('folders', ['/a']);
    expect(memento.get('folders')).toEqual(['/a']);
    expect(StorageMemento.of(document, 'sessionStorage', 'widget:files:').get('folders')).toEqual(['/a']);
    expect(StorageMemento.of(document, 'sessionStorage', 'widget:other:').get('folders')).toBeUndefined();
    expect(sessionStorage.getItem('widget:files:folders')).toBe('["/a"]');
  });

  it('forgets a value updated to undefined', async () => {
    const memento = StorageMemento.of(document, 'localStorage', 'global:sync:');
    await memento.update('followCursor', false);
    expect(memento.get('followCursor', true)).toBe(false);
    await memento.update('followCursor', undefined);
    expect(memento.get('followCursor', true)).toBe(true);
    expect(localStorage.getItem('global:sync:followCursor')).toBeNull();
  });

  it('gives defaults and keeps nothing without storage', async () => {
    const memento = new StorageMemento(() => {
      throw new Error('blocked');
    }, 'x:');
    await expect(memento.update('a', 1)).resolves.toBeUndefined();
    expect(memento.get('a', 2)).toBe(2);
    expect(new StorageMemento(() => null, 'x:').get('a')).toBeUndefined();
  });
});
