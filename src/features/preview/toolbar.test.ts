// @vitest-environment jsdom
// Tests for toolbar.ts.
import { describe, expect, it, vi } from 'vitest';
import { PreviewToolbar } from './toolbar';

describe('PreviewToolbar', () => {
  it('has a "Follow cursor" toggle that reports the new state', () => {
    const onChange = vi.fn();
    const toolbar = new PreviewToolbar(document, () => {}, { on: true, onChange });
    const button = [...toolbar.element.querySelectorAll('button')].find((b) => b.textContent === 'Follow cursor')!;
    expect(button.getAttribute('aria-pressed')).toBe('true');
    button.click();
    expect(onChange).toHaveBeenLastCalledWith(false);
    toolbar.showFollow(false);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    button.click();
    expect(onChange).toHaveBeenLastCalledWith(true);
  });
});
