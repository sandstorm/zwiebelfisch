// Tests for fuzzy.ts.
import { describe, expect, it } from 'vitest';
import { fuzzyMatch } from './fuzzy';

describe('fuzzyMatch', () => {
  it('matches everything with an empty query', () => {
    expect(fuzzyMatch('  ', 'Introduction')).toEqual({ score: 0, ranges: [] });
  });

  it('matches a piece of the target, case-insensitive, and marks it', () => {
    expect(fuzzyMatch('DUCT', 'Introduction')?.ranges).toEqual([[5, 9]]);
  });

  it('matches the characters in order, preferring word starts, and joins neighbours', () => {
    expect(fuzzyMatch('ct', 'Compile times')?.ranges).toEqual([[0, 1], [8, 9]]);
    expect(fuzzyMatch('comti', 'Compile times')?.ranges).toEqual([[0, 3], [8, 10]]);
    expect(fuzzyMatch('tor', 'tableOfRuns')?.ranges).toEqual([[0, 1], [5, 6], [7, 8]]);
  });

  it('does not match when a character is missing or out of order', () => {
    expect(fuzzyMatch('xyz', 'Introduction')).toBeNull();
    expect(fuzzyMatch('noi', 'Intro')).toBeNull();
  });

  it('scores a match at the start over one inside, a piece over scattered characters', () => {
    const score = (query: string, target: string) => fuzzyMatch(query, target)!.score;
    expect(score('res', 'Results')).toBeGreaterThan(score('res', 'Pressure'));
    expect(score('meth', 'Method')).toBeGreaterThan(score('meth', 'my eternal theory'));
    expect(score('mt', 'Method times')).toBeGreaterThan(score('mt', 'summit'));
  });
});
