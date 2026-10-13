import { SourceRange } from '../../../core/typst-document/typst-document';

/**
 * What "Find in files" looks for (VS Code's TextSearchQuery: pattern + Match Case, Match Whole Word, Use Regular
 * Expression), and the one place that knows how such a query matches text and what a match is replaced with.
 *
 * Matching goes line by line, so `^` / `$` mean line edges and a bad regular expression backtracks over one line at
 * most; a regular expression that names a line break (`\n`) searches the whole text instead (VS Code's multiline
 * search). Words are Unicode words: `ab` finds `ab` in `ab-c`, not in `abc` or `äb`. Empty matches are skipped. A
 * replacement follows JavaScript's `String.replace` (`$1`, `$<name>`, `$&`, `$$`) plus `\n` / `\t`, in regex mode only;
 * otherwise the replace text is taken as it is.
 */
export class TextQuery {
  readonly pattern: string;
  readonly isRegExp: boolean;
  readonly isCaseSensitive: boolean;
  readonly isWordMatch: boolean;
  /** Why the pattern cannot be searched for (an invalid regular expression), in words for people. */
  readonly error: string | undefined;
  /** Null for an empty or invalid pattern: nothing matches. */
  readonly #regExp: RegExp | null;
  readonly #isMultiline: boolean;

  constructor({ pattern, isRegExp = false, isCaseSensitive = false, isWordMatch = false }: TextQueryOptions) {
    this.pattern = pattern;
    this.isRegExp = isRegExp;
    this.isCaseSensitive = isCaseSensitive;
    this.isWordMatch = isWordMatch;
    this.#isMultiline = isRegExp && MULTILINE.test(pattern);
    const compiled = pattern ? compile(isRegExp ? pattern : escape(pattern), this) : null;
    this.#regExp = compiled instanceof RegExp ? compiled : null;
    this.error = typeof compiled === 'string' ? compiled : undefined;
  }

  /** The matches in `text`, in order, at most `limit`; offsets count UTF-16 code units, as string indices do. */
  findMatches(text: string, limit: number): TextMatch[] {
    const matches: TextMatch[] = [];
    if (!this.#regExp) return matches;
    const regExp = new RegExp(this.#regExp.source, `${this.#regExp.flags}g`);
    // line numbers counted on from the previous match
    let line = 1;
    let counted = 0;
    for (const [start, part] of this.#parts(text)) {
      for (const found of part.matchAll(regExp)) {
        if (matches.length >= limit) return matches;
        if (found[0] === '') continue;
        const from = start + found.index;
        line += lineBreaks(text, counted, from);
        counted = from;
        matches.push({ ...SourceRange.of({ from, to: from + found[0].length }), line });
      }
    }
    return matches;
  }

  /**
   * What `range` of `text` is replaced with for `replace`, or undefined when the text at `range` is no longer a match
   * of this query (it changed since it was found).
   */
  replacement(text: string, range: SourceRange, replace: string): string | undefined {
    if (!this.#regExp) return undefined;
    const start = this.#isMultiline ? 0 : text.lastIndexOf('\n', range.from - 1) + 1;
    const newline = this.#isMultiline ? -1 : text.indexOf('\n', range.from);
    const part = text.slice(start, newline < 0 ? text.length : newline);
    const at = new RegExp(this.#regExp.source, `${this.#regExp.flags}y`);
    at.lastIndex = range.from - start;
    const found = at.exec(part);
    if (found?.[0].length !== range.to - range.from) return undefined;
    if (!this.isRegExp) return replace;
    // a sticky regular expression replaces just the match at lastIndex, with String.replace's `$` patterns
    at.lastIndex = range.from - start;
    const replaced = part.replace(at, replace.replace(/\\([nt\\])/g, (_, escaped: string) => ESCAPES[escaped]));
    return replaced.slice(range.from - start, replaced.length - (part.length - (range.to - start)));
  }

  /** The parts of `text` searched one by one, with their offsets: its lines, or the whole text for a multiline query. */
  *#parts(text: string): Iterable<readonly [number, string]> {
    if (this.#isMultiline) return yield [0, text];
    for (let start = 0; start <= text.length; ) {
      const newline = text.indexOf('\n', start);
      const end = newline < 0 ? text.length : newline;
      yield [start, text.slice(start, end)];
      start = end + 1;
    }
  }
}

export interface TextQueryOptions {
  readonly pattern: string;
  readonly isRegExp?: boolean;
  readonly isCaseSensitive?: boolean;
  readonly isWordMatch?: boolean;
}

/** One occurrence of a query in a file's text. */
export interface TextMatch extends SourceRange {
  /** The line `from` is on, 1-based. */
  readonly line: number;
}

/** A regular expression that names a line break searches the whole text, not line by line. */
const MULTILINE = /\\n|\\r|\n/;

/** `pattern` with `query`'s options as a regular expression, or the reason it is none. */
function compile(pattern: string, { isCaseSensitive, isWordMatch }: TextQuery): RegExp | string {
  const flags = isCaseSensitive ? 'm' : 'im';
  try {
    return new RegExp(isWordMatch ? `(?<![\\p{L}\\p{M}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{M}\\p{N}_])` : pattern, `${flags}u`);
  } catch {
    // Unicode mode is stricter (`\-` outside a class is an error there); without it, words are ASCII words
    try {
      return new RegExp(isWordMatch ? `(?<!\\w)(?:${pattern})(?!\\w)` : pattern, flags);
    } catch (error) {
      return (error as Error).message.replace(/^Invalid regular expression: /, '');
    }
  }
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** How many line breaks `text` has from `from` to before `to`. */
function lineBreaks(text: string, from: number, to: number): number {
  let count = 0;
  for (let i = text.indexOf('\n', from); i >= 0 && i < to; i = text.indexOf('\n', i + 1)) count++;
  return count;
}

/** What `\n`, `\t` and `\\` stand for in a regex mode replacement. */
const ESCAPES: Record<string, string> = { n: '\n', t: '\t', '\\': '\\' };
