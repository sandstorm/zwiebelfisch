// Tests for preview-guides.ts: the view options' Typst, compiled as the preview compiles it (a prelude, then the main
// file included).
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { type FontInfo, type TypstEngine, createEngine } from '../../core/typst-engine/typst-engine';
import { SourceOffset } from '../../core/typst-document/typst-document';
import type { PreviewViewOption } from '../../hosts/preview/preview';
import type { ExtensionContext } from '../../hosts/workbench/workbench';
import { previewGuides } from './preview-guides';

const engineFiles = new URL('../../core/typst-engine/', import.meta.url);
const fontIndex: Record<string, FontInfo[]> = JSON.parse(readFileSync(new URL('fonts/index.json', engineFiles), 'utf8'));

/** The options the extension registers, by id. */
function registered(): Record<string, PreviewViewOption> {
  const options: Record<string, PreviewViewOption> = {};
  const preview = { registerViewOption: (option: PreviewViewOption) => ((options[option.id] = option), new Disposable(() => {})) };
  previewGuides().activate({ preview, subscriptions: [] } as unknown as ExtensionContext);
  return options;
}

const options = registered();
const GUIDES = options['previewGuides.pageGuides'];
const OUTLINES = options['previewGuides.boxOutlines'];

/** The file the preview compiles with `on` applied in turn: their prelude, then `/main.typ` included. */
function entry(on: readonly PreviewViewOption[]): string {
  const { prelude } = on.reduce((made, option) => option.apply(made, true), { prelude: [] as readonly string[] });
  return `${prelude.join('\n')}\n#include "/main.typ"\n`;
}

describe('previewGuides', () => {
  it('registers "Page guides" and "Box outlines", both off by default', () => {
    expect(Object.values(options).map(({ id, label, default: on }) => [id, label, on])).toEqual([
      ['previewGuides.pageGuides', 'Page guides', false],
      ['previewGuides.boxOutlines', 'Box outlines', false],
    ]);
    // drawn by the prelude itself: no package to download
    expect(entry([GUIDES])).not.toContain('#import');
    // off: nothing added
    const start = { prelude: [] };
    expect([GUIDES.apply(start, false), OUTLINES.apply(start, false)]).toEqual([start, start]);
  });
});

describe('the view options compiled', () => {
  let engine: TypstEngine;
  beforeAll(async () => {
    engine = await createEngine(readFileSync(new URL('wasm/typst_engine_bg.wasm', engineFiles)));
    for (const [name, faces] of Object.entries(fontIndex)) engine.addLazyFont({ name, faces, load: () => new Uint8Array(readFileSync(new URL(`fonts/${name}`, engineFiles))) });
  });

  /** Compiles `main` as `/main.typ` with the options `on`; none: the main file itself, as an export does. */
  async function compile(main: string, on: readonly PreviewViewOption[]) {
    engine.setSource('/main.typ', main);
    engine.setSource('/view.typ', entry(on));
    return engine.compile(on.length === 0 ? '/main.typ' : '/view.typ');
  }

  const DOCUMENT = '#set page(paper: "a6", header: [Head], footer: [Foot])\n= Title\n#lorem(150)\n#block(inset: 4pt, stroke: red)[Red]\n#box(inset: 2pt)[Box]\n';

  it('draws the guides in the guides color, without moving anything or adding pages', async () => {
    const plain = await compile(DOCUMENT, []);
    const guided = await compile(DOCUMENT, [GUIDES]);
    expect(guided.diagnostics).toEqual([]);
    expect(guided.pages.length).toBe(plain.pages.length);
    expect(plain.pages[0].svg).not.toContain('#3b82f6');
    expect(guided.pages.every((page) => page.svg.includes('#3b82f6'))).toBe(true);
    // the text stays where it was: the cursor lands on the same spot
    const offset = SourceOffset.of(DOCUMENT.indexOf('Red'));
    await compile(DOCUMENT, []);
    const before = engine.jumpFromCursor('/main.typ', offset);
    expect(before).toHaveLength(1);
    await compile(DOCUMENT, [GUIDES, OUTLINES]);
    expect(engine.jumpFromCursor('/main.typ', offset)).toEqual(before);
  });

  it('keeps a background the document sets, the guides then in the foreground', async () => {
    const own = '#set page(paper: "a6", background: rect(width: 100%, height: 100%, fill: rgb("#fff8dc")))\nText\n';
    const { pages, diagnostics } = await compile(own, [GUIDES]);
    expect(diagnostics).toEqual([]);
    expect(pages).toHaveLength(1);
    expect(pages[0].svg).toContain('#fff8dc');
    expect(pages[0].svg).toContain('#3b82f6');
    // the background first, the guides drawn after (over) the text
    expect(pages[0].svg.indexOf('#fff8dc')).toBeLessThan(pages[0].svg.indexOf('#3b82f6'));
  });

  /** The guides of a page's SVG: the x of the vertical lines and the y of the horizontal ones, in points, sorted. */
  function guidesOf(svg: string): { x: number[]; y: number[] } {
    const lines = [...svg.matchAll(/<path [^>]*stroke="#3b82f6"[^>]*transform="translate\(([-\d.]+)(?: ([-\d.]+))?\)" d="M 0 0(l 0|h)/g)];
    const sorted = (values: number[]) => values.map((value) => Math.round(value * 10) / 10).sort((a, b) => a - b);
    return {
      x: sorted(lines.filter((line) => line[3] === 'l 0').map((line) => Number(line[1]))),
      y: sorted(lines.filter((line) => line[3] === 'h').map((line) => Number(line[2] ?? 0))),
    };
  }

  // a 200pt × 400pt page: the text area, then the header's bottom and the footer's top (30 % of the margin)
  it.each([
    ['no margin set: 2.5/21 of the shorter side', '#set page(width: 210pt, height: 420pt)', [[25, 185], [17.5, 25, 395, 402.5]]],
    ['a margin', '#set page(width: 200pt, height: 400pt, margin: 10pt)', [[10, 190], [7, 10, 390, 393]]],
    ['x and y', '#set page(width: 200pt, height: 400pt, margin: (x: 10pt, y: 20pt))', [[10, 190], [14, 20, 380, 386]]],
    ['a ratio of the page, the rest', '#set page(width: 200pt, height: 400pt, margin: (left: 10%, top: 5%, rest: 30pt))', [[20, 170], [14, 20, 370, 379]]],
    ['a side left auto', '#set page(width: 210pt, height: 420pt, margin: (top: auto, rest: 10pt))', [[10, 200], [17.5, 25, 410, 413]]],
    ['header ascent and footer descent', '#set page(width: 200pt, height: 400pt, margin: 20pt, header-ascent: 5pt, footer-descent: 50% + 1pt)', [[20, 180], [15, 20, 380, 391]]],
    ['em', '#set text(size: 10pt)\n#set page(width: 200pt, height: 400pt, margin: 2em)', [[20, 180], [14, 20, 380, 386]]],
    ['two columns: the gutter, 4 % of the text width', '#set page(width: 200pt, height: 400pt, margin: 10pt, columns: 2)', [[10, 96.4, 103.6, 190], [7, 10, 390, 393]]],
    ['flipped', '#set page(width: 400pt, height: 200pt, margin: (left: 10pt, rest: 20pt), flipped: true)', [[10, 180], [14, 20, 380, 386]]],
  ] as const)('draws the guides where Typst lays the page out: %s', async (_, setup, [x, y]) => {
    const { pages, diagnostics } = await compile(`${setup}\nText\n`, [GUIDES]);
    expect(diagnostics).toEqual([]);
    expect(guidesOf(pages[0].svg)).toEqual({ x, y });
  });

  it('draws two-sided margins on the side the binding puts them, by page', async () => {
    const pages = async (setup: string) =>
      (await compile(`#set page(width: 200pt, height: 400pt, margin: (inside: 10pt, outside: 30pt))\n${setup}\nOne\n#pagebreak()\nTwo\n`, [GUIDES])).pages.map((page) => guidesOf(page.svg).x);
    expect(await pages('')).toEqual([[10, 170], [30, 190]]);
    expect(await pages('#set page(binding: right)')).toEqual([[30, 190], [10, 170]]);
    // right-to-left text binds on the right
    expect(await pages('#set text(lang: "he")')).toEqual([[30, 190], [10, 170]]);
    expect(await pages('#set text(dir: rtl)')).toEqual([[30, 190], [10, 170]]);
  });

  it.each([
    ['no page set', '= Title\n#lorem(900)\n'],
    ['a page of auto height', '#set page(height: auto)\n#lorem(900)\n'],
    ['a page of auto width', '#set page(width: auto)\n#lorem(30)\n'],
    ['a page of auto width and height', '#set page(width: auto, height: auto)\n#lorem(30)\n'],
    ['a flipped page of auto height', '#set page(flipped: true, height: auto)\n#lorem(30)\n'],
    ['a two-sided margin with x', '#set page(margin: (x: 1cm, inside: 2cm))\n#lorem(900)\n'],
    ['a template', '#let template(doc) = { set page(paper: "us-letter", margin: (x: auto, y: 1in), header: [H], columns: 2); doc }\n#show: template\n#lorem(900)\n'],
    ['pages of their own', '#page(margin: (inside: 3cm))[A]\n#page(height: auto, margin: 5%)[B]\n#lorem(900)\n'],
  ])('compiles %s without diagnostics, drawing the guides on every page', async (_, main) => {
    const { pages, diagnostics } = await compile(main, [GUIDES]);
    expect(diagnostics).toEqual([]);
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) expect(guidesOf(page.svg).x.length).toBeGreaterThanOrEqual(2);
  });

  it('outlines blocks and boxes, keeping the strokes a document gives', async () => {
    const plain = await compile(DOCUMENT, []);
    const outlined = await compile(DOCUMENT, [OUTLINES]);
    expect(outlined.diagnostics).toEqual([]);
    expect(outlined.pages.length).toBe(plain.pages.length);
    const svg = outlined.pages.map((page) => page.svg).join('');
    expect(svg).toContain('#d946ef');
    // the red block keeps its stroke (Typst's red), 1pt as Typst's default
    expect(svg).toMatch(/stroke="#ff4136"[^>]*stroke-width="1"/);
  });

  it('reports errors in the main file at the same place as without options', async () => {
    const broken = 'Text\n#unknown-thing\n';
    const plain = await compile(broken, []);
    const guided = await compile(broken, [GUIDES, OUTLINES]);
    expect(guided.diagnostics.map(({ path, from, to, message }) => ({ path, from, to, message }))).toEqual(
      plain.diagnostics.map(({ path, from, to, message }) => ({ path, from, to, message })),
    );
    expect(plain.diagnostics[0].path).toBe('/main.typ');
  });
});
