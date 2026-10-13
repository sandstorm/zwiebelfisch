import type { TextMatch } from './text-query';

/**
 * How a file's matches read in the results: each match's line with the line before and after it as context (grep's
 * `-C1`), the matches on neighbouring lines in one block where the lines they share show once, a gap between blocks.
 * A file's first and last line have only the neighbour they have; the empty "line" after a final line break is none.
 *
 * Lines are cut to show the match: a match's line without its indent, or from a little before a far match (with "…");
 * its context lines from the same column, so the block stays aligned, but never into a context line's own text, which
 * keeps the indent it has beyond the match line's. Made only for the files shown, from the text as it is.
 */
export function previewMatches(text: string, matches: readonly TextMatch[]): PreviewLine[] {
  const lines: PreviewLine[] = [];
  /** The line last shown and what of it: its number, where it ends in `text`, the column its block is cut at. */
  let last: { line: number; end: number; window: Window } | undefined;
  matches.forEach((match, index) => {
    const start = text.lastIndexOf('\n', match.from - 1) + 1;
    const newline = text.indexOf('\n', match.from);
    const end = newline < 0 ? text.length : newline;
    const source = text.slice(start, end);
    const window = windowOf(source, match.from - start);
    if (last && match.line > last.line) {
      // the line after the previous match, then a gap and the line before this one if they are not the same
      if (match.line > last.line + 1) lines.push(context(text, last.line + 1, last.end + 1, last.window));
      if (match.line > last.line + 3) lines.push({ kind: 'gap' });
      if (match.line > last.line + 2) lines.push(context(text, match.line - 1, lineBefore(text, start), window));
    } else if (!last && start > 0) {
      lines.push(context(text, match.line - 1, lineBefore(text, start), window));
    }
    const to = Math.min(match.to - start, source.length);
    const shown = source.slice(window.from, Math.max(window.from + SHOWN, to));
    const offset = window.cut.length - window.from;
    lines.push({ kind: 'match', line: match.line, text: window.cut + shown, match: [match.from - start + offset, to + offset], index });
    last = { line: match.line, end, window };
  });
  if (last && last.end + 1 < text.length) lines.push(context(text, last.line + 1, last.end + 1, last.window));
  return lines;
}

/** A line of a file's results: a match's line (`index` in the file's matches), a line around it, or a gap. */
export type PreviewLine =
  | { readonly kind: 'match'; readonly line: number; readonly text: string; readonly match: readonly [number, number]; readonly index: number }
  | { readonly kind: 'context'; readonly line: number; readonly text: string }
  | { readonly kind: 'gap' };

/** Where a block's lines are cut: from column `from`, shown after `cut` ("…" when text before it is hidden). */
interface Window {
  readonly from: number;
  readonly cut: string;
}

/** The window of a match at `column` of line `source`: from its indent, or a little before the match when far. */
function windowOf(source: string, column: number): Window {
  const indent = Math.min(source.length - source.trimStart().length, column);
  const from = Math.max(indent, column - BEFORE);
  return { from, cut: from > indent ? '…' : '' };
}

/** Line `line`, starting at `start` of `text`, cut as `window` says (no further than its own indent unless cut). */
function context(text: string, line: number, start: number, window: Window): PreviewLine {
  const newline = text.indexOf('\n', start);
  const source = text.slice(start, newline < 0 ? text.length : newline);
  const from = window.cut ? window.from : Math.min(window.from, source.length - source.trimStart().length);
  return { kind: 'context', line, text: (source.slice(0, from).trim() ? window.cut : '') + source.slice(from, from + SHOWN) };
}

/** Where the line before the one at `start` of `text` starts. */
function lineBefore(text: string, start: number): number {
  return start < 2 ? 0 : text.lastIndexOf('\n', start - 2) + 1;
}

/** Characters of a line shown before a match (more are cut, with "…"). */
const BEFORE = 30;
/** Characters of a line shown in all (more when the match is longer). */
const SHOWN = 120;
