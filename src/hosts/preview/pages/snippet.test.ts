// Tests for snippet.ts.
import { describe, expect, it } from 'vitest';
import { PageIndex, Pt } from '../../../core/typst-engine/typst-engine';
import { snippet } from './snippet';

const SVG = '<svg class="typst-doc" viewBox="0 0 200 100" width="200pt" height="100pt" xmlns="http://www.w3.org/2000/svg"><g/></svg>';
const pages = [
  { hash: 'a', width: Pt.of(200), height: Pt.of(100), svg: SVG },
  { hash: 'b', width: Pt.of(200), height: Pt.of(100), svg: SVG },
];

describe('snippet', () => {
  it("is the page's SVG with the root's viewBox and size (pt) replaced, everything else kept", () => {
    expect(snippet(pages, [{ page: PageIndex.of(0), x: Pt.of(12), y: Pt.of(22), w: Pt.of(26.12345), h: Pt.of(36) }])?.svg).toBe(
      '<svg viewBox="10 20 30.123 40" width="30.123pt" height="40pt" class="typst-doc" xmlns="http://www.w3.org/2000/svg"><g/></svg>',
    );
  });

  it('cuts out the union of the boxes on the first box page, padded', () => {
    const result = snippet(pages, [
      { page: PageIndex.of(0), x: Pt.of(50), y: Pt.of(40), w: Pt.of(10), h: Pt.of(10) },
      { page: PageIndex.of(0), x: Pt.of(70), y: Pt.of(45), w: Pt.of(10), h: Pt.of(10) },
      { page: PageIndex.of(1), x: Pt.of(0), y: Pt.of(0), w: Pt.of(100), h: Pt.of(100) },
    ]);
    expect(result).toMatchObject({ width: 34, height: 19, padding: 2 });
    expect(result?.svg).toContain('viewBox="48 38 34 19"');
  });

  it('tells the height of its tallest box: one line of its biggest text', () => {
    const result = snippet(pages, [
      { page: PageIndex.of(0), x: Pt.of(50), y: Pt.of(40), w: Pt.of(10), h: Pt.of(12.5) },
      { page: PageIndex.of(0), x: Pt.of(62), y: Pt.of(38), w: Pt.of(4), h: Pt.of(8) },
      { page: PageIndex.of(1), x: Pt.of(0), y: Pt.of(0), w: Pt.of(100), h: Pt.of(100) },
    ]);
    expect(result?.textHeight).toBe(12.5);
  });

  it('stays inside the page', () => {
    expect(snippet(pages, [{ page: PageIndex.of(0), x: Pt.of(0), y: Pt.of(95), w: Pt.of(200), h: Pt.of(5) }])?.svg).toContain('viewBox="0 93 200 7"');
  });

  it('is null when nothing is drawn', () => {
    expect(snippet(pages, [])).toBeNull();
    expect(snippet(pages, [{ page: PageIndex.of(5), x: Pt.of(0), y: Pt.of(0), w: Pt.of(1), h: Pt.of(1) }])).toBeNull();
  });
});
