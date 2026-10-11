// Tests for find-headings.ts.
import { describe, expect, it } from 'vitest';
import { findHeadings } from './find-headings';

describe('findHeadings', () => {
  it('finds every heading with its level, text and place', () => {
    const text = '= Introduction\nText.\n\n== Compile  *times* <times>\n#let x = 1\n=== \n';
    expect(findHeadings(text).map(({ level, title, range }) => [level, title, text.slice(range.from, range.to)])).toEqual([
      [1, 'Introduction', 'Introduction'],
      [2, 'Compile *times*', 'Compile  *times*'],
    ]);
  });
});
