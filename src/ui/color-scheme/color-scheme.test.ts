// Tests for color-scheme.ts.
import { describe, expect, it } from 'vitest';
import { isLightText } from './color-scheme';

describe('isLightText', () => {
  it('tells light text (a dark background) from dark text', () => {
    expect(isLightText('rgb(230, 237, 243)')).toBe(true);
    expect(isLightText('rgb(31, 35, 40)')).toBe(false);
    expect(isLightText('rgba(255, 255, 255, 0.9)')).toBe(true);
  });

  it('knows nothing from an unresolved color', () => {
    expect(isLightText('')).toBeNull();
    expect(isLightText('light-dark(black, white)')).toBeNull();
  });
});
