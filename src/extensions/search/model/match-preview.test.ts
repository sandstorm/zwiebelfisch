// Tests for match-preview.ts.
import { describe, expect, it } from 'vitest';
import { previewMatches } from './match-preview';
import { TextQuery } from './text-query';

/** The preview of `pattern`'s matches in `text`: `line: text` with the match in [ ], `line| text` for a context line. */
function preview(text: string, pattern: string, isRegExp = false): string[] {
  return previewMatches(text, new TextQuery({ pattern, isRegExp }).findMatches(text, 100)).map((line) => {
    if (line.kind === 'gap') return '…';
    if (line.kind === 'context') return `${line.line}| ${line.text}`;
    const [from, to] = line.match;
    return `${line.line}: ${line.text.slice(0, from)}[${line.text.slice(from, to)}]${line.text.slice(to)} #${line.index}`;
  });
}

describe('previewMatches', () => {
  it('shows the line before and after a match', () => {
    expect(preview('one\ntwo\nthree\nfour\n', 'two|three', true)).toEqual(['1| one', '2: [two] #0', '3: [three] #1', '4| four']);
    expect(preview('a\nb needle\nc', 'needle')).toEqual(['1| a', '2: b [needle] #0', '3| c']);
  });

  it('shows only the neighbour there is at the start and end of a file, not the empty line after the last break', () => {
    expect(preview('needle\nnext\n', 'needle')).toEqual(['1: [needle] #0', '2| next']);
    expect(preview('before\nneedle\n', 'needle')).toEqual(['1| before', '2: [needle] #0']);
    expect(preview('needle', 'needle')).toEqual(['1: [needle] #0']);
    expect(preview('\nneedle\n\n', 'needle')).toEqual(['1| ', '2: [needle] #0', '3| ']);
  });

  it('shares the lines between nearby matches, with a gap between blocks', () => {
    const text = ['1', 'x', '3', 'x', '5', '6', 'x', '8', '9', '10', 'x x'].join('\n');
    expect(preview(text, 'x')).toEqual(['1| 1', '2: [x] #0', '3| 3', '4: [x] #1', '5| 5', '6| 6', '7: [x] #2', '8| 8', '…', '10| 10', '11: [x] x #3', '11: x [x] #4']);
  });

  it('cuts a match line to the match and its context lines to the same column, keeping their extra indent', () => {
    expect(preview('  a {\n    the needle here\n  }', 'needle')).toEqual(['1| a {', '2: the [needle] here #0', '3| }']);
    expect(preview('  a {\n  needle\n      deeper', 'needle')).toEqual(['1| a {', '2: [needle] #0', '3|     deeper']);
    const far = `${'x'.repeat(100)} needle`;
    expect(preview(`${'y'.repeat(100)}\n${far}\nshort`, 'needle')).toEqual([`1| …${'y'.repeat(29)}`, `2: …${'x'.repeat(29)} [needle] #0`, '3| …']);
  });

  it('marks a match across lines up to the end of its first line', () => {
    expect(preview('ab\ncd', 'b\\nc', true)).toEqual(['1: a[b] #0', '2| cd']);
  });
});
