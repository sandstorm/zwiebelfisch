// Tests for geometry.ts.
import { describe, expect, it } from 'vitest';
import { isInside, mostVisible, percentOfPage, pointOnPage, Px } from './geometry';
import { Pt } from '../../../core/typst-engine/typst-engine';

const rect = (left: number, top: number, width: number, height: number) => ({
  left: Px.of(left),
  top: Px.of(top),
  right: Px.of(left + width),
  bottom: Px.of(top + height),
  width: Px.of(width),
  height: Px.of(height),
});

describe('percentOfPage', () => {
  it('gives a box in points as percentages of its page', () => {
    expect(percentOfPage({ x: Pt.of(50), y: Pt.of(50), w: Pt.of(50), h: Pt.of(20) }, { width: Pt.of(200), height: Pt.of(400) })).toEqual({
      left: 25,
      top: 12.5,
      width: 25,
      height: 5,
    });
  });
});

describe('pointOnPage', () => {
  it('converts a client position (px) to the point of the page drawn there (pt)', () => {
    // a 200 pt wide page drawn 400 px wide: 2 px per pt
    expect(pointOnPage({ width: Pt.of(200) }, rect(100, 50, 400, 800), Px.of(300), Px.of(250))).toEqual({ x: 100, y: 100 });
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
