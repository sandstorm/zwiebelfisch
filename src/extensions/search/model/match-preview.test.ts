// Tests for match-preview.ts.
import { describe, expect, it } from 'vitest';
import { previewMatches } from './match-preview';
import { TextQuery } from './text-query';

/** The previews of `pattern`'s matches in `text`: `line: text` with the match in [ ]. */
function preview(text: string, pattern: string, isRegExp = false): string[] {
  return previewMatches(text, new TextQuery({ pattern, isRegExp }).findMatches(text, 100)).map(({ line, text: shown, match: [from, to] }) => {
    return `${line}: ${shown.slice(0, from)}[${shown.slice(from, to)}]${shown.slice(to)}`;
  });
}

describe('previewMatches', () => {
  it('shows each match on its own line only, without the lines around it', () => {
    expect(preview('one\ntwo\nthree\nfour\n', 'two|three', true)).toEqual(['2: [two]', '3: [three]']);
    expect(preview('a\nb needle\nc', 'needle')).toEqual(['2: b [needle]']);
    expect(preview('x x', 'x')).toEqual(['1: [x] x', '1: x [x]']);
  });

  it('drops the indent, and cuts the text before a far match so the match comes early, with "…"', () => {
    expect(preview('    the needle here', 'needle')).toEqual(['1: the [needle] here']);
    const [far] = preview(`${'x'.repeat(100)} needle and more`, 'needle');
    expect(far).toBe(`1: …${'x'.repeat(19)} [needle] and more`);
    expect(far.indexOf('[')).toBeLessThanOrEqual(3 + 21);
  });

  it('keeps plenty of the line after the match (the view clamps it to its rows)', () => {
    const after = 'y'.repeat(300);
    const [shown] = preview(`needle${after}`, 'needle');
    expect(shown).toBe(`1: [needle]${'y'.repeat(154)}`);
  });

  it('marks a match across lines up to the end of its first line', () => {
    expect(preview('ab\ncd', 'b\\nc', true)).toEqual(['1: a[b]']);
  });
});
