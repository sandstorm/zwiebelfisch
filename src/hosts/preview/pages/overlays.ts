// Overlays on the preview's pages: elements positioned in percent of their page. See Preview in ../preview.ts.
import type { PageRect } from '../../../core/typst-engine/typst-engine';
import { percentOfPage } from './geometry';
import type { PageList } from './page-list';
import type { PageOverlay } from '../preview';

/**
 * Boxes (in points) drawn over the pages as elements of one class. They are children of the page
 * elements, placed in percent of the page, so they stay in place at any zoom and through lazy
 * rendering; `redraw` puts them on the pages again after the pages were rendered anew.
 *
 * What `preview.createPageOverlay` returns; `onDispose` lets the preview stop redrawing it.
 */
export class OverlayLayer implements PageOverlay {
  private boxes: readonly PageRect[] = [];
  private elements: HTMLElement[] = [];
  private disposed = false;

  constructor(
    private readonly pages: PageList,
    private readonly className: string,
    private readonly onDispose: () => void = () => {},
  ) {}

  set(boxes: readonly PageRect[]): void {
    if (this.disposed) return;
    this.boxes = boxes;
    this.redraw();
  }

  redraw(): void {
    this.clear();
    for (const box of this.boxes) {
      const hit = this.pages.at(box.page);
      if (hit) this.elements.push(overlay(hit.element, this.className, percentOfPage(box, hit.page)));
    }
  }

  dispose(): void {
    this.disposed = true;
    this.boxes = [];
    this.clear();
    this.onDispose();
  }

  private clear(): void {
    for (const element of this.elements) element.remove();
    this.elements = [];
  }
}

/** An absolutely positioned element on a page, placed in percent of the page size. */
export function overlay(page: HTMLElement, className: string, box: Partial<Record<'left' | 'top' | 'width' | 'height', number>>): HTMLElement {
  const element = page.ownerDocument.createElement('div');
  element.className = className;
  for (const [key, value] of Object.entries(box)) element.style.setProperty(key, `${value}%`);
  page.append(element);
  return element;
}
