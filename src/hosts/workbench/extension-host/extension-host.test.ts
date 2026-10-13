// Tests for extension-host.ts.
import { describe, expect, it } from 'vitest';
import { Disposable } from '../../../core/disposable/disposable';
import type { ExtensionContext, Extension } from '../workbench';
import { ExtensionHost, type OwnContext, type SharedContext } from './extension-host';

const shared = {} as SharedContext;
const own = () => ({}) as OwnContext;

function extension(id: string, activate: (context: ExtensionContext) => void): Extension {
  return { id, activate };
}

describe('ExtensionHost', () => {
  it('activates in list order and disposes in reverse, each extension\'s subscriptions in reverse', () => {
    const order: string[] = [];
    const host = new ExtensionHost(shared, own);
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
    const host = new ExtensionHost(shared, own);
    host.activate([extension('a', ({ subscriptions }) => (later = subscriptions))]);
    later.push(new Disposable(() => (disposed = true)));
    host.dispose();
    expect(disposed).toBe(true);
  });

  it('refuses an extension listed twice', () => {
    expect(() => new ExtensionHost(shared, own).activate([extension('a', () => {}), extension('a', () => {})])).toThrow(/twice/);
  });
});
