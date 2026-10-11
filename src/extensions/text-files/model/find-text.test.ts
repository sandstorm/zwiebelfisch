// Tests for find-text.ts.
import { describe, expect, it } from 'vitest';
import { findText } from './find-text';

describe('findText', () => {
  it('finds each line holding the query once, case-insensitive, with every match in it marked', () => {
    const text = 'Compile times\n  grow with pages: Compile, compile.\nnothing here\nlast COMPILE';
    const matches = findText(text, 'compile', 10);
    expect(matches.map(({ line, preview, highlights }) => [line, preview, highlights])).toEqual([
      [1, 'Compile times', [[0, 7]]],
      [2, 'grow with pages: Compile, compile.', [[17, 24], [26, 33]]],
      [4, 'last COMPILE', [[5, 12]]],
    ]);
    expect(matches.map(({ from, to }) => text.slice(from, to))).toEqual(['Compile', 'Compile', 'COMPILE']);
  });

  it('cuts a long line before the match, and stops at the limit', () => {
    const text = `${'x'.repeat(100)} needle\nneedle\nneedle\n`;
    const [first, ...rest] = findText(text, 'needle', 2);
    expect(first.preview).toBe(`…${'x'.repeat(29)} needle`);
    expect(first.highlights).toEqual([[31, 37]]);
    expect(rest).toHaveLength(1);
  });

  it('finds nothing for an empty query', () => {
    expect(findText('abc', '', 10)).toEqual([]);
  });
});
