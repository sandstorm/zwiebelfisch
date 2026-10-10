// @vitest-environment jsdom
// Tests for page-list.ts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Page } from '../../../core/typst-engine/typst-engine';
import { PageList } from './page-list';

/** Stands in for IntersectionObserver (missing in jsdom); tests decide what is near the viewport. */
class FakeObserver {
  static last: FakeObserver;
  readonly observed = new Set<Element>();
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeObserver.last = this;
  }
  observe(element: Element) {
    this.observed.add(element);
  }
  unobserve(element: Element) {
    this.observed.delete(element);
  }
  disconnect() {
    this.observed.clear();
  }
  /** Reports the given elements as near (true) or far (false). */
  report(entries: [Element, boolean][]) {
    const list = entries.map(([target, isIntersecting]) => ({ target, isIntersecting }));
    this.callback(list as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

const page = (n: number, hash = `h${n}`): Page => ({
  hash,
  width: 200,
  height: 300,
  svg: `<svg data-n="${n}"></svg>`,
});

let parent: HTMLElement;
let list: PageList;
beforeEach(() => {
  Object.assign(globalThis, { IntersectionObserver: FakeObserver });
  parent = document.createElement('div');
  document.body.append(parent);
  list = new PageList(parent, { root: parent });
});
afterEach(() => {
  list.destroy();
  parent.remove();
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
});

const svgs = () => [...parent.querySelectorAll('svg')].map((svg) => svg.dataset.n);

describe('PageList', () => {
  it('creates a sized placeholder per page and renders SVG only once a page is near the viewport', () => {
    list.render([page(1), page(2), page(3)]);
    const pages = [...parent.children] as HTMLElement[];
    expect(pages).toHaveLength(3);
    expect(pages[1].style.aspectRatio).toBe('200 / 300');
    expect(svgs()).toEqual([]);

    FakeObserver.last.report([[pages[0], true], [pages[1], true]]);
    expect(svgs()).toEqual(['1', '2']);
  });

  it('drops the SVG of pages that move far away and restores it when they come back', () => {
    list.render([page(1), page(2)]);
    const [first] = parent.children;
    FakeObserver.last.report([[first, true]]);
    FakeObserver.last.report([[first, false]]);
    expect(svgs()).toEqual([]);
    FakeObserver.last.report([[first, true]]);
    expect(svgs()).toEqual(['1']);
  });

  it('swaps only the SVG of near pages whose hash changed', () => {
    list.render([page(1), page(2)]);
    const [first, second] = parent.children;
    FakeObserver.last.report([[first, true], [second, true]]);
    const untouched = first.querySelector('svg');
    list.render([page(1), { ...page(2, 'changed'), svg: '<svg data-n="2b"></svg>' }]);
    expect(first.querySelector('svg')).toBe(untouched);
    expect(svgs()).toEqual(['1', '2b']);
  });

  it('removes pages that no longer exist', () => {
    list.render([page(1), page(2), page(3)]);
    list.render([page(1)]);
    expect(parent.children).toHaveLength(1);
    expect(FakeObserver.last.observed.size).toBe(1);
  });

  it('numbers pages and finds a page from an element inside it', () => {
    list.render([page(1), page(2)]);
    const second = parent.children[1] as HTMLElement;
    FakeObserver.last.report([[second, true]]);
    expect(second.dataset.number).toBe('2');
    const hit = list.pageAt(second.querySelector('svg')!);
    expect(hit?.index).toBe(1);
    expect(hit?.page.width).toBe(200);
    expect(list.pageAt(parent)).toBeNull();
  });

  it('sizes pages to the pane width or to a fixed scale', () => {
    list.render([page(1)]);
    const first = parent.children[0] as HTMLElement;
    expect(first.style.width).toBe('100%');
    list.setZoom(1.5);
    expect(first.style.width).toBe('400px'); // 200pt × 4/3 px/pt × 1.5
    list.render([page(1), page(2)]);
    expect((parent.children[1] as HTMLElement).style.width).toBe('400px');
    list.setZoom('fit');
    expect(first.style.width).toBe('100%');
  });

  it('renders everything when IntersectionObserver is unavailable', () => {
    list.destroy();
    delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    list = new PageList(parent, { root: parent });
    list.render([page(1), page(2)]);
    expect(svgs()).toEqual(['1', '2']);
  });
});
