// Tests for presence-markers.ts.
import { describe, expect, it } from 'vitest';
import { presenceMarkers } from './presence-markers';

const pages = [{ width: 200, height: 400 }, { width: 100, height: 100 }];
const pageSize = (page: number) => pages[page];
const ann = { id: '1', user: { name: 'Ann Lee', color: '#b58900' } };
const bob = { id: '2', user: { name: 'Bob', color: '#000080' } };

describe('presenceMarkers', () => {
  it('places a marker with initials at the first drawn position, in percent of its page', () => {
    const markers = presenceMarkers([{ ...ann, positions: [{ page: 1, x: 25, y: 50 }, { page: 0, x: 1, y: 1 }] }], pageSize);
    expect(markers).toEqual([
      { id: '1', page: 1, left: 25, top: 50, stack: 0, label: 'AL', title: 'Ann Lee', color: '#b58900', textColor: '#000000' },
    ]);
  });

  it('skips users whose caret draws nowhere or on a page that is not there', () => {
    const markers = presenceMarkers([{ ...ann, positions: [] }, { ...bob, positions: [{ page: 5, x: 1, y: 1 }] }], pageSize);
    expect(markers).toEqual([]);
  });

  it('numbers markers at the same spot so they can be drawn side by side', () => {
    const carol = { id: '3', user: { name: 'Carol', color: '#c00' } };
    const markers = presenceMarkers(
      [
        { ...ann, positions: [{ page: 0, x: 100, y: 200 }] },
        { ...bob, positions: [{ page: 0, x: 103, y: 201 }] },
        { ...carol, positions: [{ page: 0, x: 150, y: 200 }] },
      ],
      pageSize,
    );
    expect(markers.map((m) => [m.label, m.stack])).toEqual([['AL', 0], ['B', 1], ['C', 0]]);
    expect(markers[1].left).toBeCloseTo(51.5);
    expect(markers[2].left).toBe(75);
    expect(markers[1].textColor).toBe('#ffffff');
  });
});
