// Tests for caption-label.ts.
import { describe, expect, it } from 'vitest';
import { captionLabel } from './caption-label';

describe('caption labels', () => {
  it('takes the first words that say something', () => {
    const none = () => false;
    expect(captionLabel('fig:', "The company's logo.", none)).toBe('fig:company-logo');
    expect(captionLabel('tab:', 'Median compile times of the engine, per file', none)).toBe('tab:median-compile-times');
    expect(captionLabel('fig:', 'Überblick: Größe', none)).toBe('fig:uberblick-grosse');
    expect(captionLabel('fig:', 'The', none)).toBe('fig:the');
    expect(captionLabel('fig:', '…', none)).toBeNull();
  });

  it('numbers a name that is taken', () => {
    const taken = new Set(['fig:logo', 'fig:logo-2']);
    expect(captionLabel('fig:', 'Logo', (name) => taken.has(name))).toBe('fig:logo-3');
  });
});
