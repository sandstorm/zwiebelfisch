// @vitest-environment jsdom
// Tests for follow-cursor.ts.
import { describe, expect, it, vi } from 'vitest';
import type { PreviewContext } from '../../../hosts/preview/preview';
import { followCursor } from './follow-cursor';

describe('followCursor', () => {
  it('is an on/off switch that sets following, shows the new state and reports it', () => {
    let following = true;
    const preview: Partial<PreviewContext> = {
      ownerDocument: document,
      isFollowing: () => following,
      setFollowing: (on) => void (following = on),
    };
    const onChange = vi.fn();
    const [button] = followCursor({ on: false, onChange })(preview as PreviewContext).elements;
    expect(button.getAttribute('role')).toBe('switch');
    expect(button.textContent).toBe('Follow cursor');
    expect(following).toBe(false);
    expect(button.getAttribute('aria-checked')).toBe('false');
    button.click();
    expect(following).toBe(true);
    expect(button.getAttribute('aria-checked')).toBe('true');
    expect(onChange).toHaveBeenLastCalledWith(true);
    button.click();
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(button.getAttribute('aria-checked')).toBe('false');
  });
});
