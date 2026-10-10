// Tests for resize.ts.
import { describe, expect, it } from 'vitest';
import { resizedPercent } from './resize';

describe('resizedPercent', () => {
  it('follows the handle, twice as fast for centered images, in whole percent of the text width', () => {
    const start = { width: 100, reference: 400, centered: false };
    expect(resizedPercent(start, 100, 1)).toBe(50);
    expect(resizedPercent(start, 100, -1)).toBe(1);
    expect(resizedPercent({ ...start, centered: true }, -50, -1)).toBe(50);
    expect(resizedPercent(start, 1000, 1)).toBe(100);
    expect(resizedPercent({ ...start, width: 101 }, 0, 1)).toBe(25);
  });
});
