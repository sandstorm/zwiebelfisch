// Tests for diff.ts.
import { describe, expect, it } from 'vitest';
import { diffTexts, type Change } from './diff';

/** The changes as readable `[deleted, inserted]` pairs. */
function pairs(base: string, current: string): [string, string][] {
  return diffTexts(base, current).map((c: Change) => [base.slice(c.fromA, c.toA), current.slice(c.fromB, c.toB)]);
}

describe('diffTexts', () => {
  it('finds nothing in equal texts', () => {
    expect(diffTexts('Same text\n', 'Same text\n')).toEqual([]);
  });

  it('reports an insertion with its ranges in both texts', () => {
    expect(diffTexts('Hello world', 'Hello big world')).toEqual([{ fromA: 6, toA: 6, fromB: 6, toB: 10 }]);
  });

  it('reports a deletion', () => {
    expect(pairs('Hello big world', 'Hello world')).toEqual([['big ', '']]);
  });

  it('snaps changes inside a word to the whole word', () => {
    expect(pairs('The color is red', 'The colour is red')).toEqual([['color', 'colour']]);
    expect(pairs('one cat here', 'one cut here')).toEqual([['cat', 'cut']]);
  });

  it('keeps separate words separate', () => {
    expect(pairs('a b c d', 'a x c y')).toEqual([
      ['b', 'x'],
      ['d', 'y'],
    ]);
  });

  it('turns a changed markup delimiter into a change of the whole construct', () => {
    expect(pairs('Some *bold* text', 'Some _bold_ text')).toEqual([['*bold*', '_bold_']]);
    expect(pairs('Some *bold* text', 'Some bold text')).toEqual([['*bold*', 'bold']]);
    expect(pairs('Some bold text', 'Some _bold_ text')).toEqual([['bold', '_bold_']]);
    expect(pairs('= Title\n\nText\n', '== Title\n\nText\n')).toEqual([['= Title', '== Title']]);
  });

  it('leaves text changes inside formatted text alone', () => {
    expect(pairs('Some *bold* text', 'Some *bolder* text')).toEqual([['bold', 'bolder']]);
  });

  it('reports a change inside a raw block like any other', () => {
    expect(pairs('#let x = 1\n\nText\n', '#let x = 2\n\nText\n')).toEqual([['1', '2']]);
  });

  it('keeps ranges consistent when a snapped change spans several raw changes', () => {
    const base = 'aa *b* cc *d* ee';
    const current = 'aa _b_ cc d ee';
    for (const c of diffTexts(base, current)) {
      expect(base.slice(0, c.fromA)).toBe(current.slice(0, c.fromB).replace(/_b_/, '*b*'));
    }
    expect(pairs(base, current)).toEqual([
      ['*b*', '_b_'],
      ['*d*', 'd'],
    ]);
  });
});
