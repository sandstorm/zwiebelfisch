// Snippets: a page SVG cut down to the boxes of a source range (shown in the Visual view). See ../preview.ts.
import { Pt, type PageRect, type Page } from '../../../core/typst-engine/typst-engine';
import type { RenderedSnippet } from '../preview';

/** Space kept around what is drawn, so strokes and descenders are not clipped. */
const PADDING = Pt.of(2);

/**
 * The cut-out of `pages` showing `boxes` (where some source is drawn): their
 * union on the page of the first box, padded and kept inside the page, or
 * null when nothing is drawn. Content on later pages is left out.
 */
export function snippet(pages: readonly Page[], boxes: readonly PageRect[]): RenderedSnippet | null {
  const page = boxes.length > 0 ? pages[boxes[0].page] : undefined;
  if (!page) return null;
  const onPage = boxes.filter((box) => box.page === boxes[0].page);
  const x = Math.max(0, Math.min(...onPage.map((b) => b.x)) - PADDING);
  const y = Math.max(0, Math.min(...onPage.map((b) => b.y)) - PADDING);
  const right = Math.min(page.width, Math.max(...onPage.map((b) => b.x + b.w)) + PADDING);
  const bottom = Math.min(page.height, Math.max(...onPage.map((b) => b.y + b.h)) + PADDING);
  if (right <= x || bottom <= y) return null;
  const crop = { x: Pt.of(x), y: Pt.of(y), w: Pt.of(right - x), h: Pt.of(bottom - y) };
  const textHeight = Pt.of(Math.max(...onPage.map((b) => b.h)));
  return { svg: cropSvg(page.svg, crop), width: crop.w, height: crop.h, textHeight, padding: PADDING };
}

/** `svg` (a page as Typst exports it) showing only the rectangle `crop`, sized to it in pt. */
function cropSvg(svg: string, crop: { x: Pt; y: Pt; w: Pt; h: Pt }): string {
  return svg.replace(/<svg\b[^>]*>/, (tag) => {
    const rest = tag.replace(/\s(viewBox|width|height)="[^"]*"/g, '').slice('<svg'.length);
    const n = (value: number) => +value.toFixed(3);
    return `<svg viewBox="${n(crop.x)} ${n(crop.y)} ${n(crop.w)} ${n(crop.h)}" width="${n(crop.w)}pt" height="${n(crop.h)}pt"${rest}`;
  });
}
