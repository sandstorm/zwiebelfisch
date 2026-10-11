// Tests for preview-guides.ts: the view options' Typst, compiled as the preview compiles it (a prelude, then the main
// file included), with scaffolder as `mise run build:packages` caches it (skipped without it).
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { type FontInfo, type TypstEngine, createEngine } from '../../core/typst-engine/typst-engine';
import { type PackageEngine, withPackages } from '../../core/typst-packages/typst-packages';
import { SourceOffset } from '../../core/typst-document/typst-document';
import type { PreviewViewOption } from '../../hosts/preview/preview';
import type { ExtensionContext } from '../../hosts/workbench/workbench';
import { previewGuides } from './preview-guides';

const engineFiles = new URL('../../core/typst-engine/', import.meta.url);
const fontIndex: Record<string, FontInfo[]> = JSON.parse(readFileSync(new URL('fonts/index.json', engineFiles), 'utf8'));
const packages = new URL('../../../.cache/typst-packages/', import.meta.url);

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
  const { prelude } = on.reduce((made, option) => option.apply(made), { prelude: [] as readonly string[] });
  return `${prelude.join('\n')}\n#include "/main.typ"\n`;
}

const scaffolder = new URL("scaffolder-0.2.1.tar.gz", packages);

describe('previewGuides', () => {
  it('registers "Page guides" and "Box outlines", both off by default', () => {
    expect(Object.values(options).map(({ id, label, default: on }) => [id, label, on])).toEqual([
      ['previewGuides.pageGuides', 'Page guides', false],
      ['previewGuides.boxOutlines', 'Box outlines', false],
    ]);
    expect(entry([GUIDES])).toContain('@preview/scaffolder:0.2.1');
  });
});

describe.skipIf(!existsSync(scaffolder))('the view options compiled', () => {
  let engine: TypstEngine;
  let compiler: PackageEngine;
  beforeAll(async () => {
    engine = await createEngine(readFileSync(new URL('wasm/typst_engine_bg.wasm', engineFiles)));
    for (const [name, faces] of Object.entries(fontIndex)) engine.addLazyFont({ name, faces, load: () => new Uint8Array(readFileSync(new URL(`fonts/${name}`, engineFiles))) });
    compiler = withPackages(engine, async (spec) => new Uint8Array(readFileSync(new URL(`${spec.slice('@preview/'.length).replace(':', '-')}.tar.gz`, packages))));
  });

  /** Compiles `main` as `/main.typ` with the options `on`; none: the main file itself, as an export does. */
  async function compile(main: string, on: readonly PreviewViewOption[]) {
    engine.setSource('/main.typ', main);
    engine.setSource('/view.typ', entry(on));
    return compiler.compile(on.length === 0 ? '/main.typ' : '/view.typ');
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
