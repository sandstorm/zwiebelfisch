// Tests for find-figures.ts.
import { describe, expect, it } from 'vitest';
import { findFigures } from './find-figures';

describe('findFigures', () => {
  it('finds figures with a caption or a label: kind by body, caption, label, place', () => {
    const text = [
      '#figure(image("a.png"), caption: [Cold  compile _times_]) <fig:cold>',
      '#figure(table(columns: 2)[a][b], caption: [Runs])',
      '#figure(```py\nx\n```) <lst:x>',
      '#figure(image("b.png"))',
      '#let f = figure(image("c.png"), caption: [In code])',
    ].join('\n');
    expect(findFigures(text).map(({ caption, kind, label, at }) => [caption, kind, label, text.slice(at, at + 7)])).toEqual([
      ['Cold compile _times_', 'Figure', 'fig:cold', '#figure'],
      ['Runs', 'Table', null, '#figure'],
      [null, 'Listing', 'lst:x', '#figure'],
    ]);
  });
});
