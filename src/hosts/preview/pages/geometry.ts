// Preview geometry: CSS pixels (Px) as the DOM measures them, points (Pt) as the engine does, boxes in percent of a
// page, and which page or box is in view. See ../preview.ts.
import { PageIndex, Pt } from '../../../core/typst-engine/typst-engine';

/** A length in CSS pixels, as the DOM measures it (`getBoundingClientRect`, mouse events); a page's points scaled by the zoom. */
export type Px = number & { readonly __type: 'Px' };

export const Px = {
  /** `value`, in CSS pixels, as a length. */
  of(value: number): Px {
    return value as Px;
  },
};

/** The parts of a DOMRect the preview geometry needs. */
export interface Rect {
  left: Px;
  top: Px;
  right: Px;
  bottom: Px;
  width: Px;
  height: Px;
}

/** A box in percent of its page, so it stays in place at any zoom. */
export interface PercentBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where `element` is in the viewport (its bounding client rect). */
export function measure(element: Element): Rect {
  const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
  return { left: Px.of(left), top: Px.of(top), right: Px.of(right), bottom: Px.of(bottom), width: Px.of(width), height: Px.of(height) };
}

/** A box on a page of the given size, as percent of the page — stays in place at any zoom. */
export function percentOfPage(box: { x: Pt; y: Pt; w: Pt; h: Pt }, page: { width: Pt; height: Pt }): PercentBox {
  return {
    left: (box.x / page.width) * 100,
    top: (box.y / page.height) * 100,
    width: (box.w / page.width) * 100,
    height: (box.h / page.height) * 100,
  };
}

/** The point of `page` (its size) under the client position `x`, `y`, the page being drawn at `rect`. */
export function pointOnPage(page: { width: Pt }, rect: Rect, x: Px, y: Px): { x: Pt; y: Pt } {
  const ptPerPx = page.width / rect.width;
  return { x: Pt.of((x - rect.left) * ptPerPx), y: Pt.of((y - rect.top) * ptPerPx) };
}

/** Whether `target` lies fully inside `viewport`. */
export function isInside(target: Rect, viewport: Rect): boolean {
  const vertical = target.top >= viewport.top && target.bottom <= viewport.bottom;
  return vertical && target.left >= viewport.left && target.right <= viewport.right;
}

/** The page that covers the largest height of `viewport` (the first if none). */
export function mostVisible(pages: readonly Rect[], viewport: Rect): PageIndex {
  let best = 0;
  let bestHeight = 0;
  pages.forEach((page, index) => {
    const visible = Math.min(page.bottom, viewport.bottom) - Math.max(page.top, viewport.top);
    if (visible > bestHeight) [best, bestHeight] = [index, visible];
  });
  return PageIndex.of(best);
}
