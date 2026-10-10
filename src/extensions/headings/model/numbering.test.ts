// Tests for numbering.ts.
import { describe, expect, it } from 'vitest';
import { numberingFormatter } from './numbering';

const format = (pattern: string, ...numbers: number[]) => numberingFormatter(pattern)!(numbers);

describe('numberingFormatter (Typst numbering patterns)', () => {
  it('formats one counter with prefix and suffix', () => {
    expect(format('1.', 3)).toBe('3.');
    expect(format('(1)', 3)).toBe('(3)');
    expect(format('a)', 3)).toBe('c)');
    expect(format('§1', 2)).toBe('§2');
  });

  it('repeats the last counting symbol for deeper levels, separated by its prefix or the suffix', () => {
    expect(format('1.1', 2, 3, 1)).toBe('2.3.1');
    expect(format('1.', 2, 3)).toBe('2.3.');
    expect(format('1.a', 2, 3, 4)).toBe('2.c.d');
    expect(format('I.1', 1)).toBe('I');
    expect(format('1.1.', 1)).toBe('1.');
    expect(format('1.1.', 1, 2)).toBe('1.2.');
  });

  it('counts in Latin letters, Roman numerals, symbols and circled numbers', () => {
    expect([1, 26, 27, 52, 703].map((n) => format('a', n))).toEqual(['a', 'z', 'aa', 'az', 'aaa']);
    expect(format('A', 28)).toBe('AB');
    expect([1, 4, 9, 14, 40, 1994, 0].map((n) => format('I', n))).toEqual(['I', 'IV', 'IX', 'XIV', 'XL', 'MCMXCIV', 'N']);
    expect(format('i', 3)).toBe('iii');
    expect([1, 2, 6, 7, 8].map((n) => format('*', n))).toEqual(['*', '†', '‖', '**', '††']);
    expect(format('①', 3)).toBe('③');
  });

  it('falls back to Arabic numerals where a system has no representation, as Typst does', () => {
    expect(format('a', 0)).toBe('0');
    expect(format('1.a', 0, 2)).toBe('0.b');
    expect(format('①', 51)).toBe('51');
  });

  it('gives up on patterns without counting symbols or with systems it does not know', () => {
    expect(numberingFormatter('none')).toBeNull();
    expect(numberingFormatter('')).toBeNull();
    expect(numberingFormatter('一.')).toBeNull();
    expect(numberingFormatter('α')).toBeNull();
  });
});
