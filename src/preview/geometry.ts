/** The parts of a DOMRect the preview geometry needs. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** A box in percent of its page, so it stays in place at any zoom. */
export interface PercentBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** `target` relative to `page`, in percent of the page size. */
export function boxWithin(target: Rect, page: Rect): PercentBox {
  return {
    left: ((target.left - page.left) / page.width) * 100,
    top: ((target.top - page.top) / page.height) * 100,
    width: (target.width / page.width) * 100,
    height: (target.height / page.height) * 100,
  };
}

/** Whether `target` lies fully inside `viewport`. */
export function isInside(target: Rect, viewport: Rect): boolean {
  const vertical = target.top >= viewport.top && target.bottom <= viewport.bottom;
  return vertical && target.left >= viewport.left && target.right <= viewport.right;
}

/** Index of the page that covers the largest height of `viewport` (0 if none). */
export function mostVisible(pages: readonly Rect[], viewport: Rect): number {
  let best = 0;
  let bestHeight = 0;
  pages.forEach((page, index) => {
    const visible = Math.min(page.bottom, viewport.bottom) - Math.max(page.top, viewport.top);
    if (visible > bestHeight) [best, bestHeight] = [index, visible];
  });
  return best;
}
