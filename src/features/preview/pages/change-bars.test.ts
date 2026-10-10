import { describe, expect, it } from 'vitest';
import { changeBars, drawnRanges } from './change-bars';

const box = (page: number, y: number, h = 10) => ({ page, x: 50, y, w: 20, h });

describe('changeBars', () => {
  it('gives one bar per vertical stretch of changed text on each page', () => {
    expect(changeBars([box(0, 100), box(1, 40)])).toEqual([
      { page: 0, y: 100, h: 10 },
      { page: 1, y: 40, h: 10 },
    ]);
  });

  it('joins boxes on the same or adjacent lines into one bar', () => {
    expect(changeBars([box(0, 100), { page: 0, x: 200, y: 101, w: 5, h: 10 }, box(0, 112), box(0, 200)])).toEqual([
      { page: 0, y: 100, h: 22 },
      { page: 0, y: 200, h: 10 },
    ]);
  });

  it('sorts unordered boxes first', () => {
    expect(changeBars([box(0, 200), box(0, 100)])).toEqual([
      { page: 0, y: 100, h: 10 },
      { page: 0, y: 200, h: 10 },
    ]);
  });
});

describe('drawnRanges', () => {
  it('keeps non-empty ranges', () => {
    expect(drawnRanges([{ from: 3, to: 7 }])).toEqual([{ from: 3, to: 7 }]);
  });

  it('turns a pure deletion into the characters around it, so it gets a bar too', () => {
    expect(drawnRanges([{ from: 5, to: 5 }])).toEqual([{ from: 4, to: 6 }]);
    expect(drawnRanges([{ from: 0, to: 0 }])).toEqual([{ from: 0, to: 1 }]);
  });
});
