// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Position } from '../engine/engine';
import { PreviewMarkers } from './markers';

function setup(where: Record<number, Position[]>) {
  const pages = [document.createElement('div'), document.createElement('div')];
  let lookup = where;
  const markers = new PreviewMarkers({
    locate: async (_path, offset) => lookup[offset] ?? [],
    page: (index) => (pages[index] ? { element: pages[index], page: { width: 100, height: 200 } } : null),
  });
  return { pages, markers, move: (next: Record<number, Position[]>) => (lookup = next) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

describe('PreviewMarkers', () => {
  it('places a marker on the page and height where the offset appears', async () => {
    const { pages, markers } = setup({ 5: [{ page: 1, x: 10, y: 50 }] });
    markers.set('comments', [{ path: '/main.typ', offset: 5, className: 'note', attributes: { 'data-comment-id': 'a' }, title: 'Ada: hi' }]);
    await flush();
    const marker = pages[1].querySelector<HTMLElement>('.typst-preview__marker.note[data-comment-id="a"]')!;
    expect(marker.style.top).toBe('25%');
    expect(marker.title).toBe('Ada: hi');
    expect(PreviewMarkers.isMarker(marker)).toBe(true);
    expect(pages[0].children).toHaveLength(0);
  });

  it('replaces a layer as a whole and leaves other layers alone', async () => {
    const { pages, markers } = setup({ 1: [{ page: 0, x: 0, y: 10 }], 2: [{ page: 0, x: 0, y: 20 }] });
    markers.set('comments', [{ path: '/main.typ', offset: 1, className: 'note' }]);
    markers.set('diff', [{ path: '/main.typ', offset: 2, className: 'change' }]);
    await flush();
    markers.set('comments', []);
    await flush();
    expect(pages[0].querySelectorAll('.note')).toHaveLength(0);
    expect(pages[0].querySelectorAll('.change')).toHaveLength(1);
  });

  it('moves markers on refresh and skips offsets that do not appear', async () => {
    const { pages, markers, move } = setup({ 1: [{ page: 0, x: 0, y: 10 }] });
    markers.set('comments', [{ path: '/main.typ', offset: 1, className: 'note' }, { path: '/main.typ', offset: 9, className: 'note' }]);
    await flush();
    move({ 1: [{ page: 1, x: 0, y: 100 }] });
    await markers.refresh();
    expect(pages[0].querySelectorAll('.note')).toHaveLength(0);
    expect(pages[1].querySelector<HTMLElement>('.note')?.style.top).toBe('50%');
  });

  it('removes its markers on destroy', async () => {
    const { pages, markers } = setup({ 1: [{ page: 0, x: 0, y: 10 }] });
    markers.set('comments', [{ path: '/main.typ', offset: 1, className: 'note' }]);
    await flush();
    markers.destroy();
    expect(pages[0].children).toHaveLength(0);
  });
});
