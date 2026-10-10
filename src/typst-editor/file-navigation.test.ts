// @vitest-environment jsdom
// Tests for file-navigation.ts.
import { describe, expect, it, vi } from 'vitest';
import { FileNavigation } from './file-navigation';

describe('FileNavigation', () => {
  it('links the previous file at the top and the next file at the bottom; a click opens it', () => {
    const open = vi.fn();
    const navigation = new FileNavigation(document, open);
    navigation.show({ previous: '/chapters/introduction.typ', next: '/chapters/results.typ' });
    const top = navigation.top.querySelector('button')!;
    const bottom = navigation.bottom.querySelector('button')!;
    expect(navigation.top.hidden).toBe(false);
    expect(top.textContent).toBe('← chapters/introduction.typ');
    expect(top.title).toBe('Previous file: chapters/introduction.typ');
    expect(bottom.textContent).toBe('chapters/results.typ →');
    top.click();
    expect(open).toHaveBeenLastCalledWith('/chapters/introduction.typ');
    bottom.click();
    expect(open).toHaveBeenLastCalledWith('/chapters/results.typ');
  });

  it('hides the bottom link after the last file, and both for files outside the reading order', () => {
    const navigation = new FileNavigation(document, () => {});
    navigation.show({ previous: '/main.typ', next: null });
    expect([navigation.top.hidden, navigation.bottom.hidden]).toEqual([false, true]);
    navigation.show(null);
    expect([navigation.top.hidden, navigation.bottom.hidden]).toEqual([true, true]);
  });
});
