import type { TextMatch } from './text-query';

/**
 * How each of a file's matches reads in the results, in order: its line, cut so the match comes early, where a narrow
 * panel's first row still shows it (the row wraps; the view clamps it to a few rows, "…" at the end). The line starts
 * without its indent, or a little before a far match with "…". A match across lines is marked up to its line's end.
 * Made only for the files shown, from the text as it is.
 */
export function previewMatches(text: string, matches: readonly TextMatch[]): MatchPreview[] {
  return matches.map((match) => {
    const start = text.lastIndexOf('\n', match.from - 1) + 1;
    const newline = text.indexOf('\n', match.from);
    const source = text.slice(start, newline < 0 ? text.length : newline);
    const column = match.from - start;
    const to = Math.min(match.to - start, source.length);
    const indent = Math.min(source.length - source.trimStart().length, column);
    const from = Math.max(indent, column - BEFORE);
    const cut = from > indent ? '…' : '';
    const shown = source.slice(from, Math.max(from + SHOWN, to));
    return { line: match.line, text: cut + shown, match: [column - from + cut.length, to - from + cut.length] };
  });
}

/** A match's line (`line`) as the results show it, and where in that text the match is. */
export interface MatchPreview {
  readonly line: number;
  readonly text: string;
  readonly match: readonly [number, number];
}

/** Characters of a line shown before a match (more are cut, with "…"): less than a row of the narrow panel. */
const BEFORE = 20;
/** Characters of a line shown in all (more when the match is longer): more than its rows hold. */
const SHOWN = 160;
