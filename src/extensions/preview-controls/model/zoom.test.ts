// Tests for zoom.ts.
import { describe, expect, it } from 'vitest';
import { stepZoom, zoomText } from './zoom';

describe('stepZoom', () => {
  it('goes to the next preset up or down', () => {
    expect(stepZoom(1, 1)).toBe(1.25);
    expect(stepZoom(1, -1)).toBe(0.75);
  });
  it('snaps an in-between scale (from fit width) to the neighbouring preset', () => {
    expect(stepZoom(0.83, 1)).toBe(1);
    expect(stepZoom(0.83, -1)).toBe(0.75);
  });
  it('stops at the smallest and largest preset', () => {
    expect(stepZoom(0.25, -1)).toBe(0.25);
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(9, 1)).toBe(4);
  });
});

describe('zoomText', () => {
  it('names fitting the width with its scale, a fixed zoom by its percentage (whole percent)', () => {
    expect(zoomText('fit', 0.834)).toBe('Fit · 83%');
    expect(zoomText(1.25, 0.834)).toBe('125%');
    expect(zoomText(1, 0.834)).toBe('100%');
  });
});
