// Tests for event-emitter.ts.
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from './event-emitter';

describe('EventEmitter', () => {
  it('calls the listeners in subscription order until they unsubscribe', () => {
    const emitter = new EventEmitter<number>();
    const seen: string[] = [];
    const a = emitter.event((value) => seen.push(`a${value}`));
    emitter.event((value) => seen.push(`b${value}`));
    emitter.fire(1);
    a.dispose();
    emitter.fire(2);
    expect(seen).toEqual(['a1', 'b1', 'b2']);
  });

  it('skips a listener that another one unsubscribes while firing', () => {
    const emitter = new EventEmitter<void>();
    const late = vi.fn();
    emitter.event(() => second.dispose());
    const second = emitter.event(late);
    emitter.fire();
    expect(late).not.toHaveBeenCalled();
  });

  it('knows whether anyone listens', () => {
    const emitter = new EventEmitter<void>();
    expect(emitter.hasListeners).toBe(false);
    const listener = emitter.event(() => {});
    expect(emitter.hasListeners).toBe(true);
    listener.dispose();
    expect(emitter.hasListeners).toBe(false);
  });
});
