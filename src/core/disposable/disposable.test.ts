// Tests for disposable.ts.
import { describe, expect, it, vi } from 'vitest';
import { Disposable } from './disposable';

describe('Disposable', () => {
  it('undoes once, however often it is disposed', () => {
    const undo = vi.fn();
    const disposable = new Disposable(undo);
    expect(undo).not.toHaveBeenCalled();
    disposable.dispose();
    disposable.dispose();
    expect(undo).toHaveBeenCalledTimes(1);
  });
});
