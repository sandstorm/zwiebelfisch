// Tests for disposable.ts.
import { describe, expect, it, vi } from 'vitest';
import { Disposable } from './disposable';

describe('Disposable', () => {
  it('calls its cleanup once', () => {
    const cleanup = vi.fn();
    const disposable = new Disposable(cleanup);
    disposable.dispose();
    disposable.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('from: disposes several in reverse order', () => {
    const order: string[] = [];
    const all = Disposable.from(new Disposable(() => order.push('a')), { dispose: () => order.push('b') });
    all.dispose();
    expect(order).toEqual(['b', 'a']);
  });
});
