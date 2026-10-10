// Tests for color-scheme.ts.
import { describe, expect, it } from 'vitest';
import { isLightText, textColorOn } from './color-scheme';

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

describe('textColorOn', () => {
  it('picks black or white, whichever contrasts more with the background', () => {
    expect(textColorOn('#000080')).toBe('#ffffff');
    expect(textColorOn('#dc322f')).toBe('#ffffff');
    expect(textColorOn('#b58900')).toBe('#000000');
    expect(textColorOn('#859900')).toBe('#000000');
    expect(textColorOn('#ff0')).toBe('#000000');
    expect(textColorOn('rebeccapurple')).toBe('#ffffff');
  });
});
