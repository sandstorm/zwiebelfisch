// Tests for extension-host.ts.
import { describe, expect, it } from 'vitest';
import { Disposable } from '../../../core/disposable/disposable';
import type { ExtensionContext, TypstExtension } from '../workbench';
import { ExtensionHost, type SharedContext } from './extension-host';

declare module '../workbench' {
  interface ServiceRegistry {
    'test.greeting': { greet(): string };
  }
}

const shared = {} as SharedContext;

function extension(id: string, activate: (context: ExtensionContext) => void): TypstExtension {
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

  it('gives an extension the services of those before it, typed by the registry', () => {
    const seen: (string | undefined)[] = [];
    const host = new ExtensionHost(shared);
    const reader = (id: string) => extension(id, ({ services }) => seen.push(services.get('test.greeting')?.greet()));
    host.activate([
      reader('early'),
      extension('provider', ({ services, subscriptions }) => subscriptions.push(services.provide('test.greeting', { greet: () => 'hi' }))),
      reader('late'),
    ]);
    expect(seen).toEqual([undefined, 'hi']);
  });

  it('refuses a second provider of a service and an extension listed twice', () => {
    const provider = (id: string) => extension(id, ({ services }) => services.provide('test.greeting', { greet: () => id }));
    expect(() => new ExtensionHost(shared).activate([provider('a'), provider('b')])).toThrow(/provided already/);
    expect(() => new ExtensionHost(shared).activate([extension('a', () => {}), extension('a', () => {})])).toThrow(/twice/);
  });

  it('ends a service with the subscription that provided it', () => {
    const host = new ExtensionHost(shared);
    let get = (): unknown => null;
    host.activate([
      extension('provider', ({ services, subscriptions }) => subscriptions.push(services.provide('test.greeting', { greet: () => 'hi' }))),
      extension('reader', ({ services }) => (get = () => services.get('test.greeting'))),
    ]);
    expect(get()).toBeDefined();
    host.dispose();
    expect(get()).toBeUndefined();
  });
});
