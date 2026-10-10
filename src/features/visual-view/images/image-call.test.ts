import { describe, expect, it } from 'vitest';
import { imageAlt, imageArg, imageWidthCss, withImageArg, withImageWidth, withoutHash, withHash, withImageAlt } from './image-call';

describe('image call arguments', () => {
  it('reads a named argument, in markup or code form', () => {
    expect(imageArg('#image("a.png", width: 50%)', 'width')).toBe('50%');
    expect(imageArg('image("a.png", height: 2cm, width: 8cm)', 'width')).toBe('8cm');
    expect(imageArg('#image("a.png")', 'width')).toBeNull();
    expect(imageArg('#image(path)', 'width')).toBeNull();
  });

  it('replaces only the value of an existing argument', () => {
    expect(withImageArg('#image("a.png", width: 8cm, fit: "contain")', 'width', '40%')).toBe('#image("a.png", width: 40%, fit: "contain")');
    expect(withImageArg('image(\n  "a.png",\n  width: 1in,\n)', 'width', '5%')).toBe('image(\n  "a.png",\n  width: 5%,\n)');
  });

  it('adds a missing argument right after the last one', () => {
    expect(withImageArg('#image("a.png")', 'width', '50%')).toBe('#image("a.png", width: 50%)');
    expect(withImageArg('image("a.png", height: 2cm)', 'width', '50%')).toBe('image("a.png", height: 2cm, width: 50%)');
    expect(withImageArg('#image(\n  "a.png",\n)', 'width', '50%')).toBe('#image(\n  "a.png", width: 50%,\n)');
  });

  it('removes an argument with the comma before it', () => {
    expect(withImageArg('#image("a.png", alt: "x", width: 50%)', 'alt', null)).toBe('#image("a.png", width: 50%)');
    expect(withImageArg('#image("a.png", width: 50%)', 'width', null)).toBe('#image("a.png")');
    expect(withImageArg('#image("a.png")', 'width', null)).toBe('#image("a.png")');
  });

  it('leaves calls it cannot read alone', () => {
    expect(withImageArg('#image("a.png"', 'width', '50%')).toBe('#image("a.png"');
    expect(withImageArg('#rect()', 'width', '50%')).toBe('#rect()');
  });

  it('writes widths as whole percent and alt text as a string', () => {
    expect(withImageWidth('#image("a.png", width: 3cm)', 49.6)).toBe('#image("a.png", width: 50%)');
    expect(withImageAlt('#image("a.png")', 'A "cat"\\dog')).toBe('#image("a.png", alt: "A \\"cat\\"\\\\dog")');
    expect(withImageAlt('#image("a.png", alt: "x")', '')).toBe('#image("a.png")');
    expect(imageAlt('#image("a.png", alt: "A \\"cat\\"")')).toBe('A "cat"');
    expect(imageAlt('#image("a.png", alt: text)')).toBeNull();
  });

  it('shows the written width in CSS where CSS has the same unit', () => {
    expect(imageWidthCss('#image("a.png", width: 50%)')).toBe('50%');
    expect(imageWidthCss('#image("a.png", width: 2.5cm)')).toBe('2.5cm');
    expect(imageWidthCss('#image("a.png", width: 50% + 1cm)')).toBe('');
    expect(imageWidthCss('#image("a.png")')).toBe('');
  });

  it('converts between the markup and the code form', () => {
    expect(withoutHash('#image("a.png")')).toBe('image("a.png")');
    expect(withoutHash('image("a.png")')).toBe('image("a.png")');
    expect(withHash('image("a.png")')).toBe('#image("a.png")');
    expect(withHash('#image("a.png")')).toBe('#image("a.png")');
  });
});
