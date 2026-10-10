// PageList: page placeholders; SVG only for the pages near the viewport. See ../preview.ts.
import type { Page } from '../../../core/typst-engine/typst-engine';
import type { Zoom } from '../preview';

/** CSS pixels per Typst point (96 dpi / 72 pt per inch): the size of a page at 100 %. */
const PX_PER_PT = 96 / 72;

export interface PageListOptions {
  /** The scrolling element whose viewport decides which pages are near. */
  root: HTMLElement;
  /** How far outside the viewport pages still get their SVG (IntersectionObserver rootMargin). */
  margin?: string;
}

interface Entry {
  element: HTMLElement;
  content: HTMLElement;
  page: Page;
  near: boolean;
  /** Hash of the SVG currently in the DOM, or null when it is a placeholder. */
  shown: string | null;
}

/**
 * The page elements of the preview. Every page is a placeholder sized from the
 * page's width and height; only pages near the viewport carry their SVG, so
 * long documents keep a small DOM. An SVG is only replaced when the page's
 * hash changed.
 *
 * Page elements may hold overlays (the click highlight) next to the SVG;
 * they are positioned in percent of the page.
 */
export class PageList {
  private readonly entries: Entry[] = [];
  private readonly observer: IntersectionObserver | null;
  private zoom: Zoom = 'fit';

  constructor(
    private readonly parent: HTMLElement,
    options: PageListOptions,
  ) {
    this.observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((changes) => this.handleIntersections(changes), {
            root: options.root,
            rootMargin: options.margin ?? '100% 0px',
          });
  }

  render(pages: readonly Page[]): void {
    pages.forEach((page, index) => {
      const entry = this.entries[index] ?? this.add(index);
      entry.page = page;
      entry.element.dataset.hash = page.hash;
      entry.element.style.aspectRatio = `${page.width} / ${page.height}`;
      this.applyWidth(entry);
      this.sync(entry);
    });
    for (const entry of this.entries.splice(pages.length)) {
      this.observer?.unobserve(entry.element);
      entry.element.remove();
    }
  }

  setZoom(zoom: Zoom): void {
    this.zoom = zoom;
    for (const entry of this.entries) this.applyWidth(entry);
  }

  /** The current scale of the first page (1 = 100 %), also when fitting the width. */
  scale(): number {
    const entry = this.entries[0];
    if (!entry) return 1;
    if (this.zoom !== 'fit') return this.zoom;
    return entry.element.getBoundingClientRect().width / (entry.page.width * PX_PER_PT) || 1;
  }

  /** The page an element belongs to. */
  pageAt(target: Element): { index: number; element: HTMLElement; page: Page } | null {
    const index = this.entries.findIndex((entry) => entry.element.contains(target));
    return index < 0 ? null : this.at(index);
  }

  at(index: number): { index: number; element: HTMLElement; page: Page } | null {
    const entry = this.entries[index];
    return entry ? { index, element: entry.element, page: entry.page } : null;
  }

  elements(): HTMLElement[] {
    return this.entries.map((entry) => entry.element);
  }

  destroy(): void {
    this.observer?.disconnect();
    for (const entry of this.entries.splice(0)) entry.element.remove();
  }

  private add(index: number): Entry {
    const element = this.parent.ownerDocument.createElement('div');
    element.className = 'typst-preview__page';
    element.dataset.number = String(index + 1);
    const content = this.parent.ownerDocument.createElement('div');
    content.className = 'typst-preview__content';
    element.append(content);
    this.parent.append(element);
    const entry: Entry = { element, content, page: undefined!, near: !this.observer, shown: null };
    this.entries.push(entry);
    this.observer?.observe(element);
    return entry;
  }

  private applyWidth(entry: Entry): void {
    entry.element.style.width = this.zoom === 'fit' ? '100%' : `${Math.round(entry.page.width * PX_PER_PT * this.zoom * 100) / 100}px`;
  }

  private handleIntersections(changes: IntersectionObserverEntry[]): void {
    for (const change of changes) {
      const entry = this.entries.find((candidate) => candidate.element === change.target);
      if (!entry) continue;
      entry.near = change.isIntersecting;
      this.sync(entry);
    }
  }

  /** Puts the SVG in when the page is near and outdated, takes it out when far. */
  private sync(entry: Entry): void {
    const wanted = entry.near ? entry.page.hash : null;
    if (entry.shown === wanted) return;
    entry.content.innerHTML = wanted === null ? '' : entry.page.svg;
    entry.shown = wanted;
  }
}
