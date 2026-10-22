// Tests for zoom.ts.
import { describe, expect, it } from 'vitest';
import { stepZoom } from './zoom';

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
