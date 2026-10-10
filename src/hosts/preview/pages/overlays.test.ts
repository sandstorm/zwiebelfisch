// @vitest-environment jsdom
// Tests for overlays.ts.
import { describe, expect, it } from 'vitest';
import type { Page } from '../../../core/typst-engine/typst-engine';
import { OverlayLayer } from './overlays';
import { PageList } from './page-list';

const page = (n: number, hash = `h${n}`): Page => ({ hash, width: 200, height: 100, svg: `<svg data-n="${n}"></svg>` });

function setup() {
  const parent = document.body.appendChild(document.createElement('div'));
  const list = new PageList(parent, { root: parent });
  list.render([page(1), page(2)]);
  const layer = new OverlayLayer(list, 'mark');
  const marks = () =>
    [...parent.querySelectorAll<HTMLElement>('.mark')].map((mark) => ({
      page: mark.closest<HTMLElement>('.typst-preview__page')!.dataset.number,
      left: mark.style.left,
      width: mark.style.width,
    }));
  return { list, layer, marks };
}

describe('OverlayLayer', () => {
  it('places boxes in percent of their page, and replaces them when set again', () => {
    const { layer, marks } = setup();
    layer.set([{ page: 1, x: 50, y: 10, w: 20, h: 10 }]);
    expect(marks()).toEqual([{ page: '2', left: '25%', width: '10%' }]);
    layer.set([]);
    expect(marks()).toEqual([]);
  });

  it('skips pages that do not exist, and draws them again after the pages were rendered anew', () => {
    const { list, layer, marks } = setup();
    layer.set([{ page: 2, x: 0, y: 0, w: 20, h: 10 }]);
    expect(marks()).toEqual([]);
    list.render([page(1), page(2), page(3)]);
    layer.redraw();
    expect(marks()).toEqual([{ page: '3', left: '0%', width: '10%' }]);
  });
});
