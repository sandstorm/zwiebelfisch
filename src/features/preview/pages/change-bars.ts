// Change bars: margin bars beside changed text on the pages. See pages.ts.
import type { Box } from '../../../core/typst-engine/typst-engine';

/** A change bar: a vertical stretch of a page, in points from its top. */
export interface ChangeBar {
  page: number;
  y: number;
  h: number;
}

/** Boxes closer than this (pt) end up in one bar — the gap between two lines. */
const LINE_GAP = 4;

/**
 * Margin bars (like LaTeX `changebar`) for the boxes of changed text: one per
 * vertical stretch, joining boxes on the same or adjacent lines.
 */
export function changeBars(boxes: readonly Box[]): ChangeBar[] {
  const bars: ChangeBar[] = [];
  for (const { page, y, h } of [...boxes].sort((a, b) => a.page - b.page || a.y - b.y)) {
    const last = bars.at(-1);
    if (last && last.page === page && y <= last.y + last.h + LINE_GAP) {
      last.h = Math.max(last.h, y + h - last.y);
    } else {
      bars.push({ page, y, h });
    }
  }
  return bars;
}

/**
 * Source ranges whose drawn text shows a change. A pure deletion has no text
 * left, so it takes the characters on either side of it.
 */
export function drawnRanges(ranges: readonly { from: number; to: number }[]): { from: number; to: number }[] {
  return ranges.map(({ from, to }) => (from < to ? { from, to } : { from: Math.max(0, from - 1), to: from + 1 }));
}
