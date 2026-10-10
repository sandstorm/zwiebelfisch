import { describe, expect, it } from 'vitest';
import { PX_PER_PT, stepZoom, zoomLabel } from './zoom';

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

describe('zoomLabel', () => {
  it('rounds to whole percent', () => {
    expect(zoomLabel(1)).toBe('100%');
    expect(zoomLabel(0.834)).toBe('83%');
  });
});

it('converts pt to CSS px at 96 dpi', () => {
  expect(72 * PX_PER_PT).toBe(96);
});
