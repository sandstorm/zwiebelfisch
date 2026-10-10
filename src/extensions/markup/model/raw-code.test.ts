// Tests for raw-code.ts.
import { describe, expect, it } from 'vitest';
import { codeLanguage } from './raw-code';

describe('code languages', () => {
  it('accepts only what Typst reads as a language tag', () => {
    expect(codeLanguage('rust')).toBe('rust');
    expect(codeLanguage('my-lang_2')).toBe('my-lang_2');
    expect(codeLanguage('c++')).toBe('c');
    expect(codeLanguage(' 1x')).toBe('');
  });
});
