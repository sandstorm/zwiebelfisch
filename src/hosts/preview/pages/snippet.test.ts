// Tests for snippet.ts.
import { describe, expect, it } from 'vitest';
import { snippet } from './snippet';

const SVG = '<svg class="typst-doc" viewBox="0 0 200 100" width="200pt" height="100pt" xmlns="http://www.w3.org/2000/svg"><g/></svg>';
const pages = [
  { hash: 'a', width: 200, height: 100, svg: SVG },
  { hash: 'b', width: 200, height: 100, svg: SVG },
];

describe('snippet', () => {
  it("is the page's SVG with the root's viewBox and size (pt) replaced, everything else kept", () => {
    expect(snippet(pages, [{ page: 0, x: 12, y: 22, w: 26.12345, h: 36 }])?.svg).toBe(
      '<svg viewBox="10 20 30.123 40" width="30.123pt" height="40pt" class="typst-doc" xmlns="http://www.w3.org/2000/svg"><g/></svg>',
    );
  });

  it('cuts out the union of the boxes on the first box page, padded', () => {
    const result = snippet(pages, [
      { page: 0, x: 50, y: 40, w: 10, h: 10 },
      { page: 0, x: 70, y: 45, w: 10, h: 10 },
      { page: 1, x: 0, y: 0, w: 100, h: 100 },
    ]);
    expect(result).toMatchObject({ width: 34, height: 19, padding: 2 });
    expect(result?.svg).toContain('viewBox="48 38 34 19"');
  });

  it('tells the height of its tallest box: one line of its biggest text', () => {
    const result = snippet(pages, [
      { page: 0, x: 50, y: 40, w: 10, h: 12.5 },
      { page: 0, x: 62, y: 38, w: 4, h: 8 },
      { page: 1, x: 0, y: 0, w: 100, h: 100 },
    ]);
    expect(result?.textHeight).toBe(12.5);
  });

  it('stays inside the page', () => {
    expect(snippet(pages, [{ page: 0, x: 0, y: 95, w: 200, h: 5 }])?.svg).toContain('viewBox="0 93 200 7"');
  });

  it('is null when nothing is drawn', () => {
    expect(snippet(pages, [])).toBeNull();
    expect(snippet(pages, [{ page: 5, x: 0, y: 0, w: 1, h: 1 }])).toBeNull();
  });
});
