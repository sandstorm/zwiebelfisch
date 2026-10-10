/**
 * The text diff between a base version and the current text — the single
 * source for every "show changes" rendering (Source view, Visual view,
 * preview change bars).
 *
 * Starts from a character diff (`@codemirror/merge`, the same algorithm the
 * Source view's merge view uses) and cleans it up for readers:
 * - a change inside a word grows to the whole word (`color` → `colour`, not
 *   an inserted `u`);
 * - a change touching a markup delimiter (`*`, `_`, heading `=`, list
 *   markers) grows to the whole construct, so `*bold*` → `_bold_` is one
 *   change whose visible text is unchanged: a formatting change.
 */
import { diff } from '@codemirror/merge';
import type { Tree } from '@lezer/common';
import { typstParser } from 'codemirror-lang-typst/lezer';

/** `fromA..toA` in the base was replaced by `fromB..toB` in the current text. */
export interface Change {
  fromA: number;
  toA: number;
  fromB: number;
  toB: number;
}

/** The changes that turn `base` into `current`, sorted, non-overlapping, in UTF-16 offsets. */
export function diffTexts(base: string, current: string): Change[] {
  if (base === current) return [];
  const raw: Change[] = diff(base, current).map((c) => ({ fromA: c.fromA, toA: c.toA, fromB: c.fromB, toB: c.toB }));
  const a = new Side(base, raw, 'A');
  const b = new Side(current, raw, 'B');
  return merge(raw.map((change) => widen(change, a, b)));
}

type Range = { from: number; to: number };

/** Leaves whose change means the whole parent construct changed its formatting. */
const DELIMITERS = new Set(['Star', 'Underscore', 'HeadingMarker', 'ListMarker', 'EnumMarker', 'TermMarker']);
const WORD = /[\p{L}\p{N}]/u;

/** One of the two texts, with its syntax tree and a mapping to the other text through the raw changes. */
class Side {
  private tree: Tree | null = null;

  constructor(
    readonly text: string,
    private readonly raw: Change[],
    private readonly name: 'A' | 'B',
  ) {}

  /** `range` grown to whole formatted constructs and whole words. */
  expand(range: Range): Range {
    return this.toWordBoundaries(this.toConstructs(range));
  }

  /**
   * The range in the other text corresponding to `range` in this one. Ends in
   * unchanged text map one to one; ends touching a raw change take in all of it.
   */
  mapToOther({ from, to }: Range): Range {
    return { from: this.mapPoint(from, 'start'), to: this.mapPoint(to, 'end') };
  }

  private mapPoint(pos: number, end: 'start' | 'end'): number {
    const [from, to, otherFrom, otherTo] = this.name === 'A' ? (['fromA', 'toA', 'fromB', 'toB'] as const) : (['fromB', 'toB', 'fromA', 'toA'] as const);
    const touching = this.raw.filter((c) => c[from] <= pos && pos <= c[to]);
    if (touching.length > 0) return end === 'start' ? touching[0][otherFrom] : touching.at(-1)![otherTo];
    const before = this.raw.filter((c) => c[to] < pos).at(-1);
    return before ? pos - before[to] + before[otherTo] : pos;
  }

  private toConstructs(range: Range): Range {
    if (range.from === range.to) return range;
    let { from, to } = range;
    this.syntax().iterate({
      from: range.from,
      to: range.to,
      enter: (node) => {
        const parent = node.node.parent;
        if (!parent || !DELIMITERS.has(node.name) || node.from >= range.to || node.to <= range.from) return;
        from = Math.min(from, parent.from);
        to = Math.max(to, parent.to);
      },
    });
    return { from, to };
  }

  private toWordBoundaries({ from, to }: Range): Range {
    const isWord = (i: number) => i >= 0 && i < this.text.length && WORD.test(this.text[i]);
    if (isWord(from - 1) && isWord(from)) while (isWord(from - 1)) from--;
    if (isWord(to - 1) && isWord(to)) while (isWord(to)) to++;
    return { from, to };
  }

  private syntax(): Tree {
    this.tree ??= typstParser.parse(this.text);
    return this.tree;
  }
}

/** A raw change grown on both sides, kept consistent between them. */
function widen(change: Change, a: Side, b: Side): Change {
  const inA = a.expand({ from: change.fromA, to: change.toA });
  const inB = b.expand({ from: change.fromB, to: change.toB });
  const fromA = b.mapToOther(inB);
  const fromB = a.mapToOther(inA);
  return {
    fromA: Math.min(inA.from, fromA.from),
    toA: Math.max(inA.to, fromA.to),
    fromB: Math.min(inB.from, fromB.from),
    toB: Math.max(inB.to, fromB.to),
  };
}

/** Unites changes that overlap or touch in either text. */
function merge(changes: Change[]): Change[] {
  const result: Change[] = [];
  for (const change of [...changes].sort((x, y) => x.fromB - y.fromB || x.fromA - y.fromA)) {
    const last = result.at(-1);
    if (last && (change.fromB <= last.toB || change.fromA <= last.toA)) {
      last.fromA = Math.min(last.fromA, change.fromA);
      last.toA = Math.max(last.toA, change.toA);
      last.toB = Math.max(last.toB, change.toB);
    } else {
      result.push({ ...change });
    }
  }
  return result;
}
