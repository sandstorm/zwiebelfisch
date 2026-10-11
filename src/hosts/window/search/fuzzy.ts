// Fuzzy matching for search everywhere: whether a query matches a label, how well, and which characters to highlight.
// See SearchEverywhere in search.ts.

/**
 * Whether `query` matches `target` (case-insensitive): as one piece (best, earlier is better), else its characters
 * (spaces left out) in order, characters right after each other and at word starts counting more. Null: no match.
 * An empty query matches everything with score 0.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  const wanted = query.trim().toLowerCase();
  if (wanted === '') return { score: 0, ranges: [] };
  const text = target.toLowerCase();
  const at = text.indexOf(wanted);
  if (at >= 0) {
    const score = SUBSTRING + wanted.length * (1 + CONSECUTIVE) + (at === 0 ? START : isWordStart(target, at) ? WORD_START : 0);
    return { score, ranges: [[at, at + wanted.length]] };
  }
  return scattered(wanted.replace(/\s+/g, ''), text, target);
}

/** A match: higher `score` is better; `ranges` are the matched characters as [start, end) offsets, in order. */
export interface FuzzyMatch {
  readonly score: number;
  readonly ranges: readonly (readonly [number, number])[];
}

const SUBSTRING = 10;
const CONSECUTIVE = 5;

/** Bonus of a match at the start of the target, of a whole substring, of each character right after the previous one, at a word start. */
const START = 8;

/** At the start, after a non-letter-or-digit, or an upper-case letter after a lower-case one. */
function isWordStart(target: string, index: number): boolean {
  if (index === 0) return true;
  const before = target[index - 1];
  const char = target[index];
  return !/[\p{L}\p{N}]/u.test(before) || (/\p{Lu}/u.test(char) && /\p{Ll}/u.test(before));
}

const WORD_START = 3;

/** The characters of `wanted` in order in `text` (the target lowercased), preferring word starts; null if they are not all there. */
function scattered(wanted: string, text: string, target: string): FuzzyMatch | null {
  const positions: number[] = [];
  let from = 0;
  for (const char of wanted) {
    const first = text.indexOf(char, from);
    if (first < 0) return null;
    // right after the previous match, else preferably at a word start
    const next = positions.length > 0 && first === from ? first : wordStartOr(first, char, text, target);
    positions.push(next);
    from = next + 1;
  }
  let score = positions[0] === 0 ? START : 0;
  positions.forEach((position, i) => {
    score += 1;
    if (i > 0 && position === positions[i - 1] + 1) score += CONSECUTIVE;
    else if (isWordStart(target, position)) score += WORD_START;
  });
  return { score: score - (positions.at(-1)! - positions[0]) / 10, ranges: toRanges(positions) };
}

/** The first place of `char` from `first` on that starts a word, else `first`. */
function wordStartOr(first: number, char: string, text: string, target: string): number {
  for (let i = first; i >= 0; i = text.indexOf(char, i + 1)) if (isWordStart(target, i)) return i;
  return first;
}

function toRanges(positions: readonly number[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const position of positions) {
    const last = ranges.at(-1);
    if (last && last[1] === position) last[1] = position + 1;
    else ranges.push([position, position + 1]);
  }
  return ranges;
}
