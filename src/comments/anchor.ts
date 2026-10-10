import type { TextChange } from '../document/typst-document';

/** A range of the source text in UTF-16 offsets. */
export interface Range {
  from: number;
  to: number;
}

/**
 * A persisted anchor in the style of the W3C Web Annotation model: a
 * TextQuoteSelector (`exact` with some `prefix` / `suffix` context) plus a
 * TextPositionSelector (`start` / `end`) as a hint. It survives edits made
 * while the anchor was not tracked (another tool, a git pull).
 */
export interface QuoteSelector {
  start: number;
  end: number;
  exact: string;
  prefix: string;
  suffix: string;
}

/** How much context a quote keeps on each side. */
const CONTEXT = 32;

/**
 * Maps `range` through `changes` (non-overlapping, in pre-change coordinates).
 * Text inserted inside the range belongs to it, text inserted at its edges
 * does not. A replacement of exactly the range keeps it; when its text is
 * deleted the range collapses (`from === to`).
 */
export function mapRange(range: Range, changes: readonly TextChange[]): Range {
  return { from: mapOffset(range.from, changes, 1), to: mapOffset(range.to, changes, -1) };
}

/**
 * Maps one offset. With `assoc` 1 it stays after text inserted at it (a range
 * start), with -1 before it (a range end). Inside a replaced stretch it moves
 * to the replacement's end (1) or start (-1).
 */
function mapOffset(offset: number, changes: readonly TextChange[], assoc: 1 | -1): number {
  let delta = 0;
  for (const { from, to, insert } of [...changes].sort((a, b) => a.from - b.from)) {
    if (from > offset) break;
    const insertion = from === to;
    if (to < offset || (insertion && assoc > 0)) {
      delta += insert.length - (to - from);
    } else if (!insertion) {
      return mapInside(offset, { from, to, insert }, assoc) + delta;
    }
  }
  return offset + delta;
}

/** Maps an offset within `from..to` of a replacement (edges included). */
function mapInside(offset: number, { from, to, insert }: TextChange, assoc: 1 | -1): number {
  if (offset === from) return from;
  if (offset === to) return from + insert.length;
  return assoc > 0 ? from + insert.length : from;
}

/** The selector that finds `range` in `text` again. */
export function quote(text: string, range: Range): QuoteSelector {
  return {
    start: range.from,
    end: range.to,
    exact: text.slice(range.from, range.to),
    prefix: text.slice(Math.max(0, range.from - CONTEXT), range.from),
    suffix: text.slice(range.to, range.to + CONTEXT),
  };
}

/**
 * Finds `selector` in `text`: at its old position if the quote is still
 * there, else the occurrence of the quote whose context matches best (ties:
 * the one nearest the old position). Null when the quote is gone.
 */
export function reanchor(text: string, selector: QuoteSelector): Range | null {
  const { start, end, exact } = selector;
  if (exact === '') return null;
  if (text.slice(start, end) === exact) return { from: start, to: end };
  let best: { from: number; score: number; distance: number } | null = null;
  for (let from = text.indexOf(exact); from >= 0; from = text.indexOf(exact, from + 1)) {
    const candidate = { from, score: contextScore(text, from, selector), distance: Math.abs(from - start) };
    if (!best || candidate.score > best.score || (candidate.score === best.score && candidate.distance < best.distance)) {
      best = candidate;
    }
  }
  return best && { from: best.from, to: best.from + exact.length };
}

/** How many characters of the selector's prefix and suffix match around `from`. */
function contextScore(text: string, from: number, { exact, prefix, suffix }: QuoteSelector): number {
  const before = text.slice(Math.max(0, from - prefix.length), from);
  const after = text.slice(from + exact.length, from + exact.length + suffix.length);
  return commonLength(reverse(prefix), reverse(before)) + commonLength(suffix, after);
}

function commonLength(a: string, b: string): number {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) length++;
  return length;
}

function reverse(text: string): string {
  return [...text].reverse().join('');
}
