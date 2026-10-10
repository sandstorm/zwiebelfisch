import { describe, expect, it } from 'vitest';
import { boxWithin, isInside, mostVisible } from './geometry';

const rect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

describe('boxWithin', () => {
  it('gives a box as percentages of its page', () => {
    expect(boxWithin(rect(150, 250, 50, 20), rect(100, 200, 200, 400))).toEqual({
      left: 25,
      top: 12.5,
      width: 25,
      height: 5,
    });
  });
});

describe('isInside', () => {
  const viewport = rect(0, 100, 500, 400);
  it('accepts a target fully inside the viewport', () => {
    expect(isInside(rect(10, 120, 5, 20), viewport)).toBe(true);
  });
  it('rejects a target scrolled out sideways (zoomed in)', () => {
    expect(isInside(rect(520, 120, 5, 20), viewport)).toBe(false);
  });
  it('rejects a target above, below or partly cut off', () => {
    expect(isInside(rect(10, 50, 5, 20), viewport)).toBe(false);
    expect(isInside(rect(10, 600, 5, 20), viewport)).toBe(false);
    expect(isInside(rect(10, 490, 5, 20), viewport)).toBe(false);
  });
});

describe('mostVisible', () => {
  const viewport = rect(0, 0, 500, 400);
  it('picks the page covering most of the viewport', () => {
    const pages = [rect(0, -700, 500, 800), rect(0, 120, 500, 800), rect(0, 940, 500, 800)];
    expect(mostVisible(pages, viewport)).toBe(1);
  });
  it('picks the first page when nothing is visible', () => {
    expect(mostVisible([rect(0, 900, 10, 10)], viewport)).toBe(0);
    expect(mostVisible([], viewport)).toBe(0);
  });
});
