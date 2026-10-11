// Tests for cancellation.ts.
import { describe, expect, it, vi } from 'vitest';
import { CancellationTokenSource } from './cancellation';

describe('CancellationTokenSource', () => {
  it('cancels its token once and tells the listeners', () => {
    const source = new CancellationTokenSource();
    const listener = vi.fn();
    source.token.onCancellationRequested(listener);
    expect(source.token.isCancellationRequested).toBe(false);
    source.cancel();
    source.cancel();
    expect(source.token.isCancellationRequested).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('calls a listener subscribing after the cancellation at once', () => {
    const source = new CancellationTokenSource();
    source.dispose();
    const listener = vi.fn();
    source.token.onCancellationRequested(listener);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
