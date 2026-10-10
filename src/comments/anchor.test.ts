import { describe, expect, it } from 'vitest';
import { mapRange, quote, reanchor } from './anchor';

describe('mapRange', () => {
  const range = { from: 10, to: 20 };

  it('shifts with edits before the range and ignores edits after it', () => {
    expect(mapRange(range, [{ from: 2, to: 4, insert: 'xyz' }])).toEqual({ from: 11, to: 21 });
    expect(mapRange(range, [{ from: 25, to: 30, insert: '' }])).toEqual(range);
  });

  it('grows with insertions inside, not with insertions at its edges', () => {
    expect(mapRange(range, [{ from: 15, to: 15, insert: 'ab' }])).toEqual({ from: 10, to: 22 });
    expect(mapRange(range, [{ from: 10, to: 10, insert: 'ab' }])).toEqual({ from: 12, to: 22 });
    expect(mapRange(range, [{ from: 20, to: 20, insert: 'ab' }])).toEqual({ from: 10, to: 20 });
  });

  it('keeps a replacement of exactly its text', () => {
    expect(mapRange(range, [{ from: 10, to: 20, insert: 'new' }])).toEqual({ from: 10, to: 13 });
  });

  it('shrinks when a deletion overlaps one edge', () => {
    expect(mapRange(range, [{ from: 5, to: 15, insert: '' }])).toEqual({ from: 5, to: 10 });
    expect(mapRange(range, [{ from: 15, to: 25, insert: 'x' }])).toEqual({ from: 10, to: 15 });
  });

  it('collapses when its text is deleted', () => {
    expect(mapRange(range, [{ from: 8, to: 22, insert: '' }])).toEqual({ from: 8, to: 8 });
  });

  it('applies several changes given in pre-change coordinates', () => {
    const changes = [
      { from: 0, to: 1, insert: '' },
      { from: 12, to: 12, insert: '+++' },
      { from: 30, to: 30, insert: 'tail' },
    ];
    expect(mapRange(range, changes)).toEqual({ from: 9, to: 22 });
  });
});

describe('quote / reanchor', () => {
  const text = 'The quick brown fox jumps over the lazy dog. The quick brown cat.';

  it('quotes the exact text with context', () => {
    const from = text.indexOf('brown fox');
    expect(quote(text, { from, to: from + 9 })).toEqual({
      start: from,
      end: from + 9,
      exact: 'brown fox',
      prefix: 'The quick ',
      suffix: ' jumps over the lazy dog. The qu',
    });
  });

  it('finds the range again at its position when the text is unchanged', () => {
    const from = text.lastIndexOf('quick');
    expect(reanchor(text, quote(text, { from, to: from + 5 }))).toEqual({ from, to: from + 5 });
  });

  it('follows the quote after the text moved', () => {
    const from = text.indexOf('fox');
    const selector = quote(text, { from, to: from + 3 });
    const edited = `A new first sentence. ${text}`;
    const expected = edited.indexOf('fox');
    expect(reanchor(edited, selector)).toEqual({ from: expected, to: expected + 3 });
  });

  it('picks the occurrence whose context matches among several', () => {
    const from = text.lastIndexOf('quick brown');
    const selector = quote(text, { from, to: from + 11 });
    const edited = text.replace('The quick brown fox', 'Some quick brown fox, yes,');
    const expected = edited.lastIndexOf('quick brown');
    expect(reanchor(edited, selector)).toEqual({ from: expected, to: expected + 11 });
  });

  it('prefers the occurrence nearest the old position when contexts tie', () => {
    const doubled = 'ab ab ab ab';
    const selector = { start: 6, end: 8, exact: 'ab', prefix: '', suffix: '' };
    expect(reanchor(doubled, selector)).toEqual({ from: 6, to: 8 });
    expect(reanchor(`x${doubled}`, selector)).toEqual({ from: 7, to: 9 });
  });

  it('gives null when the quoted text is gone (orphan)', () => {
    const from = text.indexOf('fox');
    const selector = quote(text, { from, to: from + 3 });
    expect(reanchor(text.replace('fox', 'wolf'), selector)).toBeNull();
    expect(reanchor(text, { ...selector, exact: '' })).toBeNull();
  });
});
