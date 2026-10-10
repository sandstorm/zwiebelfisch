// Tests for minimalChange (typst-document.ts).
import { describe, expect, it } from 'vitest';
import { minimalChange } from './typst-document';

function apply(text: string, change: { from: number; to: number; insert: string } | null): string {
  return change ? text.slice(0, change.from) + change.insert + text.slice(change.to) : text;
}

describe('minimalChange', () => {
  it('returns null for identical texts', () => {
    expect(minimalChange('abc', 'abc')).toBeNull();
  });

  it('covers only the differing middle', () => {
    expect(minimalChange('Hello world', 'Hello brave world')).toEqual({ from: 6, to: 6, insert: 'brave ' });
    expect(minimalChange('a-b-c', 'a-c')).toEqual({ from: 2, to: 4, insert: '' });
  });

  it('does not let prefix and suffix overlap on repeated characters', () => {
    expect(minimalChange('aaa', 'aaaa')).toEqual({ from: 3, to: 3, insert: 'a' });
  });

  it('never splits a surrogate pair', () => {
    const change = minimalChange('x😀y', 'x😃y')!;
    expect(change.insert).toBe('😃');
    expect(apply('x😀y', change)).toBe('x😃y');
  });

  it.each([
    ['', 'new'],
    ['old', ''],
    ['abcdef', 'abXdef'],
    ['= Title\n\nBody', '= Title\n\nBody text\n'],
  ])('reconstructs %j → %j', (before, after) => {
    expect(apply(before, minimalChange(before, after))).toBe(after);
  });
});
