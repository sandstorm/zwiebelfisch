// @vitest-environment jsdom
// Tests for file-navigation.ts.
import { describe, expect, it, vi } from 'vitest';
import { FileNavigation } from './file-navigation';
import { ProjectPath } from '../../../core/paths/paths';

const path = ProjectPath.of;

const texts = (bar: HTMLElement) => [...bar.querySelectorAll('button')].map((b) => b.textContent);

describe('FileNavigation', () => {
  it('links the previous and the next file both at the top and at the bottom; a click opens it', () => {
    const open = vi.fn();
    const navigation = new FileNavigation(document, open);
    navigation.show({ previous: path('/chapters/introduction.typ'), next: path('/chapters/results.typ') });
    for (const bar of [navigation.top, navigation.bottom]) {
      expect(bar.hidden).toBe(false);
      expect(texts(bar)).toEqual(['← chapters/introduction.typ', 'chapters/results.typ →']);
    }
    expect(navigation.top.querySelector('button')!.title).toBe('Previous file: chapters/introduction.typ');
    navigation.bottom.querySelector<HTMLButtonElement>('button:last-child')!.click();
    expect(open).toHaveBeenLastCalledWith('/chapters/results.typ');
    navigation.top.querySelector('button')!.click();
    expect(open).toHaveBeenLastCalledWith('/chapters/introduction.typ');
  });

  it('has no next link after the last file, and no bars outside the reading order', () => {
    const navigation = new FileNavigation(document, () => {});
    navigation.show({ previous: path('/main.typ'), next: null });
    expect(texts(navigation.top)).toEqual(['← main.typ']);
    expect(texts(navigation.bottom)).toEqual(['← main.typ']);
    navigation.show(null);
    expect([navigation.top.hidden, navigation.bottom.hidden]).toEqual([true, true]);
  });
});
