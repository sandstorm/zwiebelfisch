// @vitest-environment jsdom
// Tests for preview.ts: the "Follow cursor" switch.
import { describe, expect, it, vi } from 'vitest';
import type { PreviewContext } from '../../../hosts/preview/preview';
import { followCursor } from './preview';

describe('followCursor', () => {
  it('is an on/off switch that shows its state and reports every change', () => {
    const onChange = vi.fn();
    const [button] = followCursor({ on: false, onChange })({ ownerDocument: document } as PreviewContext).elements;
    expect(button.getAttribute('role')).toBe('switch');
    expect(button.textContent).toBe('Follow cursor');
    expect(button.getAttribute('aria-checked')).toBe('false');
    button.click();
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(onChange).toHaveBeenLastCalledWith(true);
    button.click();
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(button.getAttribute('aria-checked')).toBe('false');
  });
});
