// Tests for preview-guides.ts: the view options' Typst, compiled as the preview compiles it (a prelude, then the main
// file included).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { type FontInfo, type TypstEngine, createEngine } from '../../core/typst-engine/typst-engine';
import { SourceOffset, SourceRange } from '../../core/typst-document/typst-document';
import { withPackages } from '../../core/typst-packages/typst-packages';
import type { PreviewEntry, PreviewViewOption } from '../../hosts/preview/preview';
import type { ExtensionContext } from '../../hosts/extension-host/extension-host';
import { previewGuides } from './preview-guides';

const engineFiles = new URL('../../core/typst-engine/', import.meta.url);
const fontIndex: Record<string, FontInfo[]> = JSON.parse(readFileSync(new URL('fonts.gen/index.json', engineFiles), 'utf8'));
/** merman, which the docs' template imports, as the e2e tests cache it (too big for a fixture). */
const merman = new URL('../../../.cache/typst-packages/merman-0.4.0.tar.gz', import.meta.url);

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
const SPACING = options['previewGuides.blockSpacing'];

/** The file the preview compiles with `on` applied in turn: their prelude, then `/main.typ` included. */
function entry(on: readonly PreviewViewOption[]): string {
  const { prelude } = on.reduce<PreviewEntry>((made, option) => option.apply(made, true), { output: 'pages', prelude: [] });
  return `${prelude.join('\n')}\n#include "/main.typ"\n`;
}

describe('previewGuides', () => {
  it('registers "Page guides", "Box outlines" and "Block spacing", all off by default', () => {
    expect(Object.values(options).map(({ id, label, default: on }) => [id, label, on])).toEqual([
      ['previewGuides.pageGuides', 'Page guides', false],
      ['previewGuides.boxOutlines', 'Box outlines', false],
      ['previewGuides.blockSpacing', 'Block spacing', false],
    ]);
    // drawn by the prelude itself: no package to download
    expect(entry([GUIDES])).not.toContain('#import');
    // off: nothing added
    const start = { output: 'pages' as const, prelude: [] };
    expect([GUIDES, OUTLINES, SPACING].map((option) => option.apply(start, false))).toEqual([start, start, start]);
  });
});

describe('the view options compiled', () => {
  let engine: TypstEngine;
  beforeAll(async () => {
    engine = await createEngine(readFileSync(new URL('wasm.gen/typst_engine_bg.wasm', engineFiles)));
    for (const [name, faces] of Object.entries(fontIndex)) engine.addLazyFont({ name, faces, load: () => new Uint8Array(readFileSync(new URL(`fonts.gen/${name}`, engineFiles))) });
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
    await compile(DOCUMENT, [GUIDES, OUTLINES, SPACING]);
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

  /**
   * The heights of a page's spacing bands (the paths filled with a hatch), in points, in the order drawn: `v` for the
   * `v(…)` bands (hatched `/`), `gaps` for the gaps between blocks and paragraphs (hatched `\`).
   */
  function bandsOf(svg: string): { v: number[]; gaps: number[] } {
    const gapHatches = new Set([...svg.matchAll(/<pattern id="([^"]+)"(?:(?!<\/pattern>).)*?d="M 0 0l 4 4"/g)].map((hatch) => hatch[1]));
    const bands = [...svg.matchAll(/<path fill="url\(#([^)]+)\)"[^>]*d="M 0 0h [\d.]+v ([\d.]+)h/g)];
    const heights = (gaps: boolean) => bands.filter((band) => gapHatches.has(band[1]) === gaps).map((band) => Math.round(Number(band[2]) * 10) / 10);
    return { v: heights(false), gaps: heights(true) };
  }

  /**
   * The page count and where the main file's glyphs are drawn, after compiling `main` with the options `on`: the
   * glyph runs of each of its characters (no shape's syntax node fits in one character, so no outline or band).
   */
  async function layoutOf(main: string, on: readonly PreviewViewOption[]) {
    const { pages, diagnostics } = await compile(main, on);
    expect(diagnostics).toEqual([]);
    const characters = Array.from(main, (_, from) => SourceRange.of({ from, to: from + 1 }));
    // to a thousandth of a point: the bands' frames change the floating-point sums, not where anything is
    const glyphs = engine.boxesForRanges('/main.typ', characters).map(({ page, ...box }) => [page, ...Object.values(box).map((value) => Math.round(value * 1000) / 1000)]);
    return { pages: pages.length, glyphs };
  }

  // docs/template.typ's title page and heading rules, and spacing that collapses, is dropped, splits lists or overflows
  const SPACED = `#let title-page(it) = page(header: none, footer: none, margin: (x: 2.6cm, y: 2.4cm), {
  rect(width: 5.5cm, height: 1cm)
  v(1fr)
  text(fill: blue, weight: "bold", size: 11pt, tracking: 0.12em, upper[Documentation])
  v(0.4em)
  block(below: 12pt, text(size: 34pt, weight: "bold", it))
  line(length: 3.2cm, stroke: 5pt + yellow)
  v(2fr)
  text(size: 9pt)[Company · #link("https://sandstorm.de")[sandstorm.de]]
})
#set document(title: [Book])
#set page(paper: "a6", header: [Head], footer: [Foot])
#set heading(numbering: "1.1")
#show title: it => title-page(it)
#show heading.where(level: 1): it => {
  pagebreak(weak: true)
  v(4cm)
  block(below: 16pt, text(size: 28pt, it))
  block(above: 16pt, line(length: 3.2cm, stroke: 5pt + yellow))
}
#show heading.where(level: 2): it => pagebreak(weak: true) + v(1cm) + it
#title()
= Part
Text #v(1em, weak: true) after weak.
#v(10pt, weak: true)
#v(20pt, weak: true)
Para.
== Chapter
Before the list
- item
#v(8pt, weak: true)
- item2
+ one
+ two #v(4pt) more
/ Term: description
#figure(rect(height: 1cm), caption: [Caption])
#quote(block: true, attribution: [Me])[Quoted]
#block(height: 2cm)[top #v(1fr) bottom]
#v(1em)
#pagebreak()
#v(30pt, weak: true)
Top.
#v(40pt)
#v(1fr)
After.
#v(400pt)
Overflow.
`;

  it('shades vertical spacing as laid out, moving nothing, each option alone and both: fixed, fr, weak, at a page top, in show rules', async () => {
    // the document's own set rules take the outlines away, which are drawn shapes too
    const unstroked = `#set block(stroke: none)\n#set box(stroke: none)\n${SPACED}`;
    const plain = await layoutOf(unstroked, []);
    expect(plain.pages).toBe(5);
    for (const on of [[OUTLINES], [GUIDES, OUTLINES], [SPACING], [OUTLINES, SPACING]]) expect(await layoutOf(unstroked, on)).toEqual(plain);

    // each option alone draws its own bands only
    const alone = async (option: PreviewViewOption) => (await compile(SPACED, [option])).pages.map((page) => bandsOf(page.svg));
    const bands = (await compile(SPACED, [OUTLINES, SPACING])).pages.map((page) => bandsOf(page.svg));
    expect(await alone(OUTLINES)).toEqual(bands.map(({ v }) => ({ v, gaps: [] })));
    expect(await alone(SPACING)).toEqual(bands.map(({ gaps }) => ({ v: [], gaps })));
    // the title page: 1fr, 0.4em of the title's 18.7pt, 2fr (twice the 1fr); the gaps around the title are the
    // title's own block spacing (1.125em of 18.7pt), set for all it shows: it wins over the paragraph's spacing (set
    // beats auto) and over the 12pt below (the larger of two set ones)
    const [fr, , twoFr] = bands[0].v;
    expect(bands[0]).toEqual({ v: [fr, 7.5, twoFr], gaps: [21, 21] });
    expect(twoFr).toBeCloseTo(2 * fr, 0);
    // a part: 4cm, the heading's 16pt to the bar, the bar's 0.75em below (the heading's, too) to the text; weak spacing
    // collapsed into the paragraphs' spacing shows as their gap: 1em, then the larger of 10pt and 20pt
    expect(bands[1]).toEqual({ v: [113.4], gaps: [16, 8.3, 11, 20] });
    // a chapter: 1cm, 4pt in the enum, the 1fr in the block, the 1em after it; the gaps: the heading's, a tight list's
    // 0.65em after a paragraph, the weak 8pt between the lists it splits, the blocks' 1.2em, the figure's caption gap,
    // the figure's and the quote's spacing and the attribution's
    expect(bands[2]).toEqual({ v: [28.3, 4, expect.any(Number), 11], gaps: [8.3, 7.2, 8, 13.2, 13.2, 13.2, 13.2, 7.2, 26.4, 9.9, 19.8] });
    // dropped at the page top, then 40pt; the 1fr gets nothing as the 400pt runs past the page's bottom; no gap
    // across a fraction
    expect(bands[3]).toEqual({ v: [40, 400], gaps: [] });
    expect(bands[4]).toEqual({ v: [], gaps: [] });
  });

  // gaps around sticky and breakable blocks at a page break, lists, a table, a grid, a figure, a quote, a box
  const GAPS = `#set page(paper: "a6", header: [Head], footer: [Foot])
#set par(spacing: 10pt, leading: 5pt)
#lorem(150)
= Sticky heading at the page bottom
#lorem(40)
#block(breakable: true, inset: 2pt, below: 20pt)[#lorem(140)]
After the breakable block.
#table(columns: 2, [a], [b], [Cell with\\ two lines], [d])
#grid(columns: 1, [first], [second])
- tight
- list
#block(below: 12pt)[Set below]
#line(length: 2cm)

Wide

- wide

- list
#figure(rect(height: 1cm), caption: [Caption])
#quote(block: true, attribution: [Me])[Quoted]
#block(above: 1fr)[Fr above]
Text #box(block[in a box]) after.
`;

  it('shades the gaps between blocks and paragraphs as laid out, moving nothing, with and without the outlines', async () => {
    const unstroked = `#set block(stroke: none)\n#set box(stroke: none)\n${GAPS}`;
    const plain = await layoutOf(unstroked, []);
    expect(plain.pages).toBe(4);
    for (const on of [[OUTLINES], [SPACING], [OUTLINES, SPACING]]) expect(await layoutOf(unstroked, on)).toEqual(plain);

    const bands = (await compile(GAPS, [SPACING])).pages.map((page) => bandsOf(page.svg).gaps);
    expect((await compile(GAPS, [OUTLINES, SPACING])).pages.map((page) => bandsOf(page.svg).gaps)).toEqual(bands);
    // the heading moved to the next page with the paragraph it sticks to: no gap left behind
    expect(bands[0]).toEqual([]);
    // below the heading (0.75em), above the breakable block
    expect(bands[1]).toEqual([8.3, 10]);
    // below the breakable block where it ends (20pt), around the table, the grid and the tight list (no 0.65em after a
    // block), the set 12pt over the line's 10pt, a wide list, the figure's caption gap; not between the cells, the
    // list items, nor across the page break after the figure
    expect(bands[2]).toEqual([20, 10, 10, 10, 10, 12, 10, 10, 10, 7.2]);
    // in the quote, below the block after a fraction above it; none in the box
    expect(bands[3]).toEqual([9.9, 10]);
  });

  it.skipIf(!existsSync(merman))('lays out this documentation\'s book on as many pages with the outlines and bands', async () => {
    const docs = fileURLToPath(new URL('../../../docs/', import.meta.url));
    for (const path of readdirSync(docs, { recursive: true, encoding: 'utf8' })) {
      const file = join(docs, path);
      if (!statSync(file).isFile()) continue;
      if (path.endsWith('.typ')) engine.setSource(`/${path}`, readFileSync(file, 'utf8'));
      else engine.setBinary(`/${path}`, new Uint8Array(readFileSync(file)));
    }
    // the hosts' contracts the docs' `#api(..)` reads, from the repository root
    const hosts = fileURLToPath(new URL('../../hosts/', import.meta.url));
    for (const path of readdirSync(hosts, { recursive: true, encoding: 'utf8' })) {
      if (path.endsWith('.ts')) engine.setBinary(`/src/hosts/${path}`, new Uint8Array(readFileSync(join(hosts, path))));
    }
    const packages = withPackages(engine, async () => new Uint8Array(readFileSync(merman)));
    const plain = await packages.compile('/main.typ');
    expect(plain.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
    engine.setSource('/view.typ', entry([GUIDES, OUTLINES, SPACING]));
    const viewed = await packages.compile('/view.typ');
    expect(viewed.diagnostics).toEqual(plain.diagnostics);
    expect(viewed.pages).toHaveLength(plain.pages.length);
    const bands = viewed.pages.map((page) => bandsOf(page.svg));
    expect(bands.filter((page) => page.v.length > 0).length).toBeGreaterThan(10);
    expect(bands.filter((page) => page.gaps.length > 0).length).toBeGreaterThan(viewed.pages.length / 2);
    // the title page's gaps around the title (its own block spacing, see above), the first part's 16pt to the bar
    expect(bands[0].gaps).toEqual([20.1, 20.1]);
    expect(bands.find((page) => page.v[0] === 113.4)?.gaps[0]).toBe(16);
  }, 120_000);

  it('reports errors in the main file at the same place as without options', async () => {
    const broken = 'Text\n#unknown-thing\n';
    const plain = await compile(broken, []);
    const guided = await compile(broken, [GUIDES, OUTLINES, SPACING]);
    expect(guided.diagnostics.map(({ path, from, to, message }) => ({ path, from, to, message }))).toEqual(
      plain.diagnostics.map(({ path, from, to, message }) => ({ path, from, to, message })),
    );
    expect(plain.diagnostics[0].path).toBe('/main.typ');
  });
});
