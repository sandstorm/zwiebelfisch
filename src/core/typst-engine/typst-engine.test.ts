// Tests for createEngine (typst-engine.ts), against the built wasm.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { type FontInfo, type TypstEngine, PageIndex, Pt, createEngine } from './typst-engine';
import { SourceOffset, SourceRange } from '../typst-document/typst-document';
import { withPackages } from '../typst-packages/typst-packages';

const wasm = readFileSync(new URL('./wasm/typst_engine_bg.wasm', import.meta.url));
const fontDir = new URL('./fonts/', import.meta.url);
/** The default fonts' index (`mise run build:fonts`): file name → faces. */
const fontIndex: Record<string, FontInfo[]> = JSON.parse(readFileSync(new URL('index.json', fontDir), 'utf8'));
const fontFile = (name: string) => new Uint8Array(readFileSync(new URL(name, fontDir)));
/** merman, as the e2e tests cache it (too big for a fixture); the test using it is skipped without it. */
const merman = new URL('../../../.cache/typst-packages/merman-0.4.0.tar.gz', import.meta.url);

/** An engine with the default fonts, loaded lazily; `loaded` lists the files in the order they were loaded. */
async function engineWithFonts(loaded: string[] = []): Promise<TypstEngine> {
  const engine = await createEngine(wasm);
  for (const [name, faces] of Object.entries(fontIndex)) {
    engine.addLazyFont({ name, faces, load: () => (loaded.push(name), fontFile(name)) });
  }
  return engine;
}

describe('TypstEngine', () => {
  let engine: TypstEngine;
  beforeAll(async () => {
    engine = await engineWithFonts();
  });

  it.each(['Libertinus Serif', 'New Computer Modern', 'New Computer Modern Math', 'DejaVu Sans Mono'])(
    'renders text in the default font family %s',
    (family) => {
      engine.setSource('/main.typ', `#text(font: "${family}")[Hello *bold* _italic_]`);
      const { pages, diagnostics } = engine.compile('/main.typ');
      expect(diagnostics).toEqual([]);
      expect(pages[0].svg).toContain('<path');
    },
  );

  it('renders math with the default math font', () => {
    engine.setSource('/main.typ', '$ sum_(i=1)^n i = (n(n+1))/2 $');
    const { pages, diagnostics } = engine.compile('/main.typ');
    expect(diagnostics).toEqual([]);
    expect(pages[0].svg).toContain('<path');
  });

  it('accepts fonts added after creation', async () => {
    const bare = await createEngine(wasm);
    bare.setSource('/main.typ', '#text(font: "DejaVu Sans Mono")[Hi]');
    expect(bare.compile('/main.typ').diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'warning', message: expect.stringContaining('unknown font family') }),
    );
    bare.addFont(fontFile('DejaVuSansMono.ttf'));
    expect(bare.compile('/main.typ').diagnostics).toEqual([]);
  });

  it('rejects data that is not a font', async () => {
    const bare = await createEngine(wasm);
    expect(() => bare.addFont(new Uint8Array([1, 2, 3]))).toThrow(/no font/);
  });

  it('compiles a document to one SVG per page', () => {
    engine.setSource('/main.typ', 'Hello\n#pagebreak()\nWorld');
    const { pages, diagnostics } = engine.compile('/main.typ');
    expect(diagnostics).toEqual([]);
    expect(pages).toHaveLength(2);
    expect(pages[0].svg).toMatch(/^<svg/);
    expect(pages[0].width).toBeCloseTo(595.28, 1); // A4 in pt
  });

  it('keeps the hash of unchanged pages stable across edits', () => {
    engine.setSource('/main.typ', 'Page one\n#pagebreak()\nPage two');
    const before = engine.compile('/main.typ').pages;
    engine.setSource('/main.typ', 'Page one\n#pagebreak()\nPage two, edited');
    const after = engine.compile('/main.typ').pages;
    expect(after[0].hash).toBe(before[0].hash);
    expect(after[1].hash).not.toBe(before[1].hash);
  });

  it('reports errors with UTF-16 source ranges', () => {
    const source = 'Größe 😀 #unknown';
    engine.setSource('/main.typ', source);
    const { pages, diagnostics } = engine.compile('/main.typ');
    expect(pages).toEqual([]);
    expect(diagnostics).toHaveLength(1);
    const [d] = diagnostics;
    expect(d.severity).toBe('error');
    expect(d.path).toBe('/main.typ');
    expect(source.slice(d.from, d.to)).toBe('unknown');
  });

  it('jumps from a click on text to its source range', () => {
    const source = '#set page(width: 200pt, height: 100pt, margin: 0pt)\nHällo world';
    engine.setSource('/main.typ', source);
    engine.compile('/main.typ');
    const jump = engine.jumpFromClick(PageIndex.of(0), Pt.of(5), Pt.of(5));
    expect(jump).toMatchObject({ kind: 'source', path: '/main.typ' });
    if (jump?.kind !== 'source') throw new Error('expected source jump');
    expect(source.slice(jump.from, jump.to)).toBe('Hällo world');
    expect(jump.offset).toBeGreaterThanOrEqual(jump.from);
  });

  it('returns highlight boxes for the clicked text: one per line, containing the click', () => {
    const words = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda';
    engine.setSource('/main.typ', `#set page(width: 120pt, height: 200pt, margin: 0pt)\n= Title\n\n${words}`);
    engine.compile('/main.typ');
    const title = engine.jumpFromClick(PageIndex.of(0), Pt.of(4), Pt.of(8));
    if (title?.kind !== 'source') throw new Error('expected source jump');
    expect(title.boxes).toHaveLength(1);
    const [box] = title.boxes;
    expect(box.page).toBe(0);
    expect(box.x).toBeLessThanOrEqual(4);
    expect(box.x + box.w).toBeGreaterThan(4);
    expect(box.w).toBeLessThan(120); // the title, not the page
    expect(box.y).toBeLessThanOrEqual(8);
    expect(box.y + box.h).toBeGreaterThanOrEqual(8);

    const source = `#set page(width: 120pt, height: 200pt, margin: 0pt)\n= Title\n\n${words}`;
    const [at] = engine.jumpFromCursor('/main.typ', SourceOffset.of(source.indexOf('alpha') + 1));
    const paragraph = engine.jumpFromClick(PageIndex.of(0), at.x, Pt.of(at.y - 2));
    if (paragraph?.kind !== 'source') throw new Error('expected source jump');
    expect(paragraph.boxes.length).toBeGreaterThan(1); // the paragraph wraps
    expect(new Set(paragraph.boxes.map((b) => Math.round(b.y))).size).toBe(paragraph.boxes.length);
  });

  it('returns boxes for the text drawn from source ranges, at character precision', () => {
    const words = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda';
    const source = `#set page(width: 120pt, height: 200pt, margin: 0pt)\n${words}\n#pagebreak()\nsecond page`;
    engine.setSource('/main.typ', source);
    engine.compile('/main.typ');
    const gamma = source.indexOf('gamma');
    const boxes = engine.boxesForRanges('/main.typ', [SourceRange.of({ from: gamma, to: gamma + 5 })]);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].page).toBe(0);
    expect(boxes[0].x).toBeGreaterThan(10);
    expect(boxes[0].w).toBeLessThan(40);

    const both = engine.boxesForRanges('/main.typ', [
      SourceRange.of({ from: gamma, to: gamma + 5 }),
      SourceRange.of({ from: source.indexOf('second'), to: source.indexOf('second') + 6 }),
    ]);
    expect(both.map((b) => b.page)).toEqual([0, 1]);
    expect(engine.boxesForRanges('/main.typ', [SourceRange.of({ from: 0, to: 10 })])).toEqual([]); // code, not drawn text
    expect(engine.boxesForRanges('/other.typ', [SourceRange.of({ from: gamma, to: gamma + 5 })])).toEqual([]);
  });

  it('returns boxes for shapes drawn from source ranges, e.g. rectangles and fraction lines', () => {
    const source = '#set page(width: 200pt, height: 200pt, margin: 0pt)\n#v(50pt)\n#rect(width: 40pt, height: 30pt)\n\n$ 1/2 $';
    engine.setSource('/main.typ', source);
    engine.compile('/main.typ');
    const rect = source.indexOf('#rect');
    const [box] = engine.boxesForRanges('/main.typ', [SourceRange.of({ from: rect, to: rect + '#rect(width: 40pt, height: 30pt)'.length })]);
    expect(box.y).toBeCloseTo(49.5, 1); // 50pt down, minus half the stroke
    expect(box.w).toBeGreaterThanOrEqual(40);
    expect(box.h).toBeGreaterThanOrEqual(30);
    const math = source.indexOf('$ 1/2 $');
    const boxes = engine.boxesForRanges('/main.typ', [SourceRange.of({ from: math, to: math + 7 })]);
    expect(boxes.length).toBeGreaterThanOrEqual(3); // numerator, denominator, line
    expect(boxes.every((b) => b.y > 80)).toBe(true);
  });

  it('returns boxes for everything an element in the ranges draws, also from code in another file', () => {
    engine.setSource('/helpers.typ', '#let picture() = rect(width: 60pt, height: 40pt, fill: blue)');
    const figure = '#figure(picture(), caption: [Cap])';
    const source = `#import "helpers.typ": picture
#set page(width: 200pt, height: 200pt, margin: 0pt)
Hello #picture() world

${figure}`;
    engine.setSource('/main.typ', source);
    expect(engine.compile('/main.typ').diagnostics).toEqual([]);
    const from = source.indexOf(figure);
    const boxes = engine.boxesForRanges('/main.typ', [SourceRange.of({ from, to: from + figure.length })]);
    const rect = boxes.find((b) => b.w >= 60 && b.h >= 40); // drawn with the spans of helpers.typ
    expect(rect?.y).toBeGreaterThan(40); // the figure's, below the paragraph's
    // a paragraph gets the span of its first word: asking for that word does not take the whole paragraph
    const hello = engine.boxesForRanges('/main.typ', [SourceRange.of({ from: source.indexOf('Hello'), to: source.indexOf('Hello') + 5 })]);
    expect(hello).toHaveLength(1);
    expect(hello[0].h).toBeLessThan(40);
  });

  it.skipIf(!existsSync(merman))('returns boxes for the Mermaid figure of the advanced demo, drawn by the merman package', async () => {
    const demo = fileURLToPath(new URL('../../../demo/examples/advanced/', import.meta.url));
    for (const path of readdirSync(demo, { recursive: true, encoding: 'utf8' })) {
      const file = join(demo, path);
      if (!statSync(file).isFile()) continue;
      if (path.endsWith('.typ')) engine.setSource(`/${path}`, readFileSync(file, 'utf8'));
      else engine.setBinary(`/${path}`, new Uint8Array(readFileSync(file)));
    }
    const source = readFileSync(join(demo, 'chapters/method.typ'), 'utf8');
    const packages = withPackages(engine, async () => new Uint8Array(readFileSync(merman)));
    expect((await packages.compile('/main.typ')).diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    const from = source.indexOf('#figure(\n  mermaid');
    const to = source.indexOf('<fig:measurement>') + '<fig:measurement>'.length;
    const boxes = engine.boxesForRanges('/chapters/method.typ', [SourceRange.of({ from, to })]);
    const caption = boxes.filter((b) => b.h < 20);
    const picture = boxes.filter((b) => b.h >= 20);
    expect(caption.length).toBeGreaterThan(0);
    expect(picture.length).toBeGreaterThan(0);
    expect(Math.min(...picture.map((b) => b.y))).toBeLessThan(Math.min(...caption.map((b) => b.y)));
  });

  it('returns nothing for a click on empty space', () => {
    engine.setSource('/main.typ', '#set page(width: 200pt, height: 100pt, margin: 0pt)\nHi');
    engine.compile('/main.typ');
    expect(engine.jumpFromClick(PageIndex.of(0), Pt.of(150), Pt.of(90))).toBeNull();
  });

  it('jumps from a cursor in the source to positions in the preview', () => {
    const source = '#set page(width: 200pt, height: 100pt, margin: 0pt)\nfirst\n#pagebreak()\nsecond';
    engine.setSource('/main.typ', source);
    engine.compile('/main.typ');
    const positions = engine.jumpFromCursor('/main.typ', SourceOffset.of(source.indexOf('second') + 2));
    expect(positions).toHaveLength(1);
    expect(positions[0].page).toBe(1);
  });

  it('compiles a document that includes and imports other files', () => {
    engine.setSource('/chapters/intro.typ', '= Intro\n#import "../lib.typ": name\nHello #name');
    engine.setSource('/lib.typ', '#let name = "Ada"');
    engine.setSource('/main.typ', '#include "chapters/intro.typ"');
    const { pages, diagnostics } = engine.compile('/main.typ');
    expect(diagnostics).toEqual([]);
    expect(pages).toHaveLength(1);
  });

  it('reports errors in other files with their path', () => {
    const lib = '#let name = oops';
    engine.setSource('/lib.typ', lib);
    engine.setSource('/main.typ', '#import "lib.typ": name');
    const { diagnostics } = engine.compile('/main.typ');
    expect(diagnostics[0]).toMatchObject({ severity: 'error', path: '/lib.typ' });
    expect(lib.slice(diagnostics[0].from, diagnostics[0].to)).toBe('oops');
  });

  it('renders an image from a binary file', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';
    engine.setBinary('/img/logo.svg', new TextEncoder().encode(svg));
    engine.setSource('/main.typ', '#image("img/logo.svg", width: 2cm)');
    const { pages, diagnostics } = engine.compile('/main.typ');
    expect(diagnostics).toEqual([]);
    expect(pages[0].svg).toContain('<image');
    engine.remove('/img/logo.svg');
    expect(engine.compile('/main.typ').diagnostics[0].message).toMatch(/not found/);
  });

  it('lists imported packages it has no files of', () => {
    engine.setSource('/main.typ', '#import "@preview/absent:0.2.0": x');
    const result = engine.compile('/main.typ');
    expect(result.missingPackages).toEqual(['@preview/absent:0.2.0']);
    expect(result.diagnostics[0].message).toContain('package not found');
  });

  it('compiles against package files added under their package path', () => {
    const manifest =
      '[package]\nname = "tiny"\nversion = "1.0.0"\nentrypoint = "src/lib.typ"\nauthors = ["T"]\nlicense = "MIT"\ndescription = "t"\n';
    engine.setBinary('@preview/tiny:1.0.0/typst.toml', new TextEncoder().encode(manifest));
    engine.setSource('@preview/tiny:1.0.0/src/lib.typ', '#let shout(x) = oops');
    engine.setSource('/main.typ', '#import "@preview/tiny:1.0.0": shout\n#shout("hi")');
    const result = engine.compile('/main.typ');
    expect(result.missingPackages).toEqual([]);
    // the error is in the package file, which has no project path
    expect(result.diagnostics[0]).toMatchObject({ path: null, message: expect.stringContaining('oops') });
    engine.setSource('@preview/tiny:1.0.0/src/lib.typ', '#let shout(x) = upper(x)');
    expect(engine.compile('/main.typ').diagnostics).toEqual([]);
  });

  it('rejects malformed package paths', () => {
    expect(() => engine.setSource('@preview/no-version/lib.typ', '')).toThrow(/invalid/);
  });
});

describe('TypstEngine lazy fonts', () => {
  it('knows every face up front but loads a file only when a compile uses one of its faces, once', async () => {
    const loaded: string[] = [];
    const engine = await engineWithFonts(loaded);
    engine.setSource('/main.typ', 'Hello');
    expect(engine.compile('/main.typ').diagnostics).toEqual([]);
    expect(loaded).toEqual(['LibertinusSerif-Regular.otf']);
    engine.setSource('/main.typ', 'Hello *bold* `mono`');
    expect(engine.compile('/main.typ').diagnostics).toEqual([]);
    expect(loaded).toEqual(['LibertinusSerif-Regular.otf', 'LibertinusSerif-Bold.otf', 'DejaVuSansMono.ttf']);
  });

  it('embeds lazily loaded fonts in a PDF', async () => {
    const loaded: string[] = [];
    const engine = await engineWithFonts(loaded);
    engine.setSource('/main.typ', '$ x^2 $');
    const { pdf } = engine.exportPdf('/main.typ');
    expect(loaded).toEqual(['NewCMMath-Book.otf']);
    expect(new TextDecoder('latin1').decode(pdf!)).toContain('NewCMMath');
  });

  it('falls back to other fonts when a file cannot be loaded, warns once, and does not ask again', async () => {
    const engine = await createEngine(wasm);
    let asked = 0;
    const regular = 'LibertinusSerif-Regular.otf';
    engine.addLazyFont({ name: regular, faces: fontIndex[regular], load: () => (asked++, null) });
    engine.addFont(fontFile('DejaVuSansMono.ttf'));
    engine.setSource('/main.typ', 'Hello');
    const first = engine.compile('/main.typ');
    expect(first.pages[0].svg).toContain('<path');
    expect(first.diagnostics).toEqual([
      {
        severity: 'warning',
        message: 'Font file LibertinusSerif-Regular.otf could not be loaded; Typst used another font.',
        hints: [],
        path: null,
        from: 0,
        to: 0,
      },
    ]);
    expect(engine.compile('/main.typ').diagnostics).toEqual([]);
    expect(engine.exportPdf('/main.typ').diagnostics).toEqual([]);
    expect(asked).toBe(1);
  });

  it('warns about a font file that cannot be loaded in the PDF export that needed it', async () => {
    const engine = await createEngine(wasm);
    const math = 'NewCMMath-Book.otf';
    engine.addLazyFont({ name: math, faces: fontIndex[math], load: () => null });
    engine.addFont(fontFile('LibertinusSerif-Regular.otf'));
    engine.setSource('/main.typ', '$ x^2 $');
    expect(engine.exportPdf('/main.typ').diagnostics.map((d) => d.message)).toContain(
      'Font file NewCMMath-Book.otf could not be loaded; Typst used another font.',
    );
  });

  it('rejects a lazy font without faces', async () => {
    const engine = await createEngine(wasm);
    expect(() => engine.addLazyFont({ name: 'empty.otf', faces: [], load: () => null })).toThrow(/faces/);
  });
});

describe('TypstEngine.exportPdf', () => {
  let engine: TypstEngine;
  beforeAll(async () => {
    engine = await engineWithFonts();
  });
  const text = (pdf: Uint8Array) => new TextDecoder('latin1').decode(pdf);

  it('exports a PDF file', () => {
    engine.setSource('/main.typ', '= Title\nHello *PDF*');
    const { pdf, diagnostics, missingPackages } = engine.exportPdf('/main.typ');
    expect(diagnostics).toEqual([]);
    expect(missingPackages).toEqual([]);
    expect(text(pdf!).startsWith('%PDF-')).toBe(true);
    expect(text(pdf!).trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('gives no PDF but the errors for a document with errors', () => {
    engine.setSource('/main.typ', 'Text #oops');
    const { pdf, diagnostics } = engine.exportPdf('/main.typ');
    expect(pdf).toBeNull();
    expect(diagnostics).toEqual([expect.objectContaining({ severity: 'error', path: '/main.typ', from: 6, to: 10 })]);
  });

  it('exports another entry without touching the compiled document used for hit-testing', () => {
    engine.setSource('/main.typ', 'Preview text');
    engine.compile('/main.typ');
    engine.setSource('/other.typ', '#include "/main.typ"\nMore');
    expect(engine.exportPdf('/other.typ').pdf).not.toBeNull();
    expect(engine.jumpFromCursor('/main.typ', SourceOffset.of(3))).toHaveLength(1);
    // the preview's next compile still compiles its own main file
    engine.setSource('/main.typ', 'Preview text #oops');
    expect(engine.compile('/main.typ').diagnostics[0].path).toBe('/main.typ');
    expect(engine.exportPdf('/nope.typ').diagnostics[0].message).toMatch(/not found/);
  });

  it('reports packages it has no files of', () => {
    engine.setSource('/main.typ', '#import "@preview/absent:0.2.0": x');
    expect(engine.exportPdf('/main.typ')).toMatchObject({ pdf: null, missingPackages: ['@preview/absent:0.2.0'] });
  });
});
