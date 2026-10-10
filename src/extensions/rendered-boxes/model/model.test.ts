// Tests for model.ts: which boxes get a snippet, and how big it is drawn.
import { describe, expect, it } from 'vitest';
import { inlinePictureSize, rendersInPlace, snippetSize } from './model';

describe('inlinePictureSize', () => {
  it('draws a one-line snippet one text line tall (em), its padding hanging into negative margins', () => {
    // 11pt text: glyph runs 12.65pt tall (1.15 em), padded by 2pt above and below
    const size = inlinePictureSize({ height: 16.65, textHeight: 12.65, padding: 2 })!;
    expect(size.height).toBeCloseTo(16.65 / 11);
    expect(size.margin).toBeCloseTo(-2 / 11);
    expect(size.height + 2 * size.margin).toBeCloseTo(1.15);
  });

  it('keeps taller snippets (two lines, fractions) proportionally taller', () => {
    const one = inlinePictureSize({ height: 16.65, textHeight: 12.65, padding: 2 })!;
    const two = inlinePictureSize({ height: 29.3, textHeight: 12.65, padding: 2 })!;
    expect(two.height + 2 * two.margin).toBeCloseTo(2 * (one.height + 2 * one.margin));
  });

  it('is null without a text height to scale by (shown at its own size)', () => {
    expect(inlinePictureSize({ height: 10 })).toBeNull();
    expect(inlinePictureSize({ height: 10, textHeight: 0, padding: 2 })).toBeNull();
  });
});

describe('snippetSize', () => {
  it('is the width in pt for a block box, and for an inline one without a text height', () => {
    expect(snippetSize({ svg: '', width: 30, height: 12 }, false)).toEqual({ width: '30pt', height: '', margin: '' });
    expect(snippetSize({ svg: '', width: 30, height: 12 }, true)).toEqual({ width: '30pt', height: '', margin: '' });
  });

  it('is the height and margins in em for an inline box', () => {
    const { height, margin } = inlinePictureSize({ height: 16.5, textHeight: 12.5, padding: 2 })!;
    expect(snippetSize({ svg: '', width: 30, height: 16.5, textHeight: 12.5, padding: 2 }, true)).toEqual({ width: '', height: `${height}em`, margin: `${margin}em` });
  });
});

describe('rendersInPlace', () => {
  it('is false for code that only defines or configures', () => {
    for (const src of ['#set text(red)', '#show: x', '#let a = 1', '#import "a.typ"', '#include "c.typ"', '// note']) {
      expect(rendersInPlace(src)).toBe(false);
    }
    for (const src of ['$ x $', '#figure(image("a.png"))', '#text(red)[x]', '#highlight[x]']) {
      expect(rendersInPlace(src)).toBe(true);
    }
  });
});
