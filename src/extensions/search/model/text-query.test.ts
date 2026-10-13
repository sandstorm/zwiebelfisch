// Tests for text-query.ts.
import { describe, expect, it } from 'vitest';
import { SourceRange } from '../../../core/typst-document/typst-document';
import { TextQuery, type TextQueryOptions } from './text-query';

/** The matched texts of `options` in `text`. */
function found(text: string, options: TextQueryOptions): string[] {
  return new TextQuery(options).findMatches(text, 100).map(({ from, to }) => text.slice(from, to));
}

describe('TextQuery.findMatches', () => {
  it('finds every occurrence, case-insensitive unless Match Case is on, with line numbers', () => {
    const text = 'Compile times\n  grow: Compile, compile.\n\nlast COMPILE';
    const matches = new TextQuery({ pattern: 'compile' }).findMatches(text, 100);
    expect(matches.map(({ from, to, line }) => [text.slice(from, to), line])).toEqual([
      ['Compile', 1],
      ['Compile', 2],
      ['compile', 2],
      ['COMPILE', 4],
    ]);
    expect(found(text, { pattern: 'compile', isCaseSensitive: true })).toEqual(['compile']);
  });

  it('takes the pattern literally unless it is a regular expression', () => {
    expect(found('a.b axb (c)', { pattern: 'a.b' })).toEqual(['a.b']);
    expect(found('a.b axb (c)', { pattern: '(c)' })).toEqual(['(c)']);
    expect(found('a.b axb', { pattern: 'a.b', isRegExp: true })).toEqual(['a.b', 'axb']);
  });

  it('matches whole words by Unicode letters, and case-insensitively beyond ASCII', () => {
    const text = 'ab abc äab ab-c _ab Ab';
    expect(new TextQuery({ pattern: 'ab', isWordMatch: true }).findMatches(text, 100).map(({ from }) => from)).toEqual([0, 11, 20]);
    expect(found('ÄRGER ärger', { pattern: 'ärger' })).toEqual(['ÄRGER', 'ärger']);
    expect(found('foo foobar', { pattern: 'fo+', isRegExp: true, isWordMatch: true })).toEqual(['foo']);
  });

  it('matches regular expressions line by line, so ^ and $ are line edges, and skips empty matches', () => {
    const text = '= One\ntext = two\n= Three';
    expect(found(text, { pattern: '^= \\w+$', isRegExp: true })).toEqual(['= One', '= Three']);
    expect(found(text, { pattern: 'x*', isRegExp: true })).toEqual(['x']);
    expect(found('a\nb', { pattern: 'a[^c]b', isRegExp: true })).toEqual([]);
  });

  it('searches across lines when the regular expression names a line break', () => {
    const text = 'two\nthree\nzero\nten';
    const matches = new TextQuery({ pattern: 'o\\nt', isRegExp: true }).findMatches(text, 100);
    expect(matches.map(({ from, to, line }) => [text.slice(from, to), line])).toEqual([
      ['o\nt', 1],
      ['o\nt', 3],
    ]);
  });

  it('accepts what only non-Unicode regular expressions allow, and reports an invalid one', () => {
    expect(found('a-b', { pattern: 'a\\-b', isRegExp: true })).toEqual(['a-b']);
    const invalid = new TextQuery({ pattern: '(a', isRegExp: true });
    expect(invalid.error).toMatch(/\(a/);
    expect(invalid.findMatches('(a', 10)).toEqual([]);
    expect(new TextQuery({ pattern: '(a' }).error).toBeUndefined();
  });

  it('finds nothing for an empty pattern, and stops at the limit', () => {
    expect(found('abc', { pattern: '' })).toEqual([]);
    expect(new TextQuery({ pattern: 'a' }).findMatches('a\na\na', 2)).toHaveLength(2);
  });
});

describe('TextQuery.replacement', () => {
  /** The replacements of every match of `options` in `text` by `replace`. */
  function replacements(text: string, options: TextQueryOptions, replace: string): (string | undefined)[] {
    const query = new TextQuery(options);
    return query.findMatches(text, 100).map((match) => query.replacement(text, match, replace));
  }

  it('takes the replace text as it is for a literal pattern', () => {
    expect(replacements('a $1 a', { pattern: 'a' }, '$& \\n')).toEqual(['$& \\n', '$& \\n']);
  });

  it("substitutes groups as String.replace does, and \\n, \\t, \\\\ in regex mode", () => {
    const text = 'let x = 1\nlet yy = 22';
    expect(replacements(text, { pattern: 'let (\\w+) = (?<value>\\d+)', isRegExp: true }, '$1: $<value> ($&) $$')).toEqual([
      'x: 1 (let x = 1) $',
      'yy: 22 (let yy = 22) $',
    ]);
    expect(replacements('a', { pattern: 'a', isRegExp: true }, '\\n\\t\\\\n')).toEqual(['\n\t\\n']);
  });

  it('keeps lookarounds and line edges as the search saw them', () => {
    expect(replacements('xa ya\nya', { pattern: '(?<=y)a|^y', isRegExp: true }, '[$&]')).toEqual(['[a]', '[y]', '[a]']);
  });

  it('is undefined when the text at the range is no longer a match', () => {
    const query = new TextQuery({ pattern: 'ab', isWordMatch: true });
    expect(query.replacement('ab', SourceRange.of({ from: 0, to: 2 }), 'x')).toBe('x');
    expect(query.replacement('abc', SourceRange.of({ from: 0, to: 2 }), 'x')).toBeUndefined();
    expect(query.replacement('xb', SourceRange.of({ from: 0, to: 2 }), 'x')).toBeUndefined();
    expect(query.replacement('ab', SourceRange.of({ from: 0, to: 1 }), 'x')).toBeUndefined();
  });
});
