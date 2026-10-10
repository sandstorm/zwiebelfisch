import { describe, expect, it } from 'vitest';
import { inlineSource } from './inline-source';

describe('inlineSource', () => {
  it('removes the common indentation of HTML-embedded source', () => {
    const html = '\n      = Title\n\n      - item\n        nested\n    ';
    expect(inlineSource(html)).toBe('= Title\n\n- item\n  nested\n');
  });

  it('keeps unindented text unchanged apart from the leading newline', () => {
    expect(inlineSource('\n= Title\nBody\n')).toBe('= Title\nBody\n');
  });

  it('ignores whitespace-only lines when finding the indentation', () => {
    expect(inlineSource('\n    a\n\n  \n    b')).toBe('a\n\n\nb\n');
  });

  it('returns an empty string for empty or blank content', () => {
    expect(inlineSource('')).toBe('');
    expect(inlineSource('\n   \n  ')).toBe('');
  });
});
