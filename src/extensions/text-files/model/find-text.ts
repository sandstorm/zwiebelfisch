// Text search in one file: the lines holding a query, as search everywhere shows them. See ../text-files.ts.

/** Every line of `text` holding `query` (case-insensitive), up to `limit` of them, in order. */
export function findText(text: string, query: string, limit: number): TextMatch[] {
  const wanted = query.toLowerCase();
  const lower = text.toLowerCase();
  const matches: TextMatch[] = [];
  let at = wanted ? lower.indexOf(wanted) : -1;
  // line numbers counted on from the previous match's line
  let line = 1;
  let counted = 0;
  while (at >= 0 && matches.length < limit) {
    const start = text.lastIndexOf('\n', at - 1) + 1;
    line += newlines(text, counted, start);
    counted = start;
    const newline = text.indexOf('\n', at);
    const end = newline < 0 ? text.length : newline;
    matches.push({ line, ...matchIn(text.slice(start, end), lower.slice(start, end), wanted, at - start), from: at, to: at + wanted.length });
    at = newline < 0 ? -1 : lower.indexOf(wanted, end);
  }
  return matches;
}

/** A line holding the query: its number, the part shown, the matches in that part, and the first match in the file. */
export interface TextMatch {
  /** 1-based. */
  readonly line: number;
  /** The line, cut to show the first match (leading spaces dropped). */
  readonly preview: string;
  /** Every match in `preview`, as [start, end) offsets. */
  readonly highlights: readonly (readonly [number, number])[];
  /** The first match in the line, as offsets into the whole text. */
  readonly from: number;
  readonly to: number;
}

/** How many line breaks `text` has from `from` to before `to`. */
function newlines(text: string, from: number, to: number): number {
  let count = 0;
  for (let i = text.indexOf('\n', from); i >= 0 && i < to; i = text.indexOf('\n', i + 1)) count++;
  return count;
}

/** The part of `line` shown for the match at `column`, with every match of the line in it marked. */
function matchIn(line: string, lowerLine: string, wanted: string, column: number): Pick<TextMatch, 'preview' | 'highlights'> {
  const indent = line.length - line.trimStart().length;
  const shownFrom = Math.max(indent, column - BEFORE);
  const cut = shownFrom > indent ? '…' : '';
  const preview = cut + line.slice(shownFrom, shownFrom + SHOWN);
  const highlights: [number, number][] = [];
  for (let i = lowerLine.indexOf(wanted, shownFrom); i >= 0 && i + wanted.length <= shownFrom + SHOWN; i = lowerLine.indexOf(wanted, i + wanted.length)) {
    highlights.push([i - shownFrom + cut.length, i - shownFrom + cut.length + wanted.length]);
  }
  return { preview, highlights };
}

/** Characters of a line shown before the first match in it (more are cut, with "…"). */
const BEFORE = 30;
/** Characters of a line shown in all. */
const SHOWN = 120;
