// @vitest-environment jsdom
// Tests for toolbar.ts.
import { describe, expect, it, vi } from 'vitest';
import { PreviewToolbar } from './toolbar';

describe('PreviewToolbar', () => {
  it('has a "Follow cursor" on/off switch that shows and reports the new state', () => {
    const onChange = vi.fn();
    const toolbar = new PreviewToolbar(document, () => {}, { on: true, onChange });
    const button = toolbar.element.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(button.textContent).toBe('Follow cursor');
    expect(button.getAttribute('aria-checked')).toBe('true');
    button.click();
    expect(onChange).toHaveBeenLastCalledWith(false);
    toolbar.showFollow(false);
    expect(button.getAttribute('aria-checked')).toBe('false');
    button.click();
    expect(onChange).toHaveBeenLastCalledWith(true);
  });
});
