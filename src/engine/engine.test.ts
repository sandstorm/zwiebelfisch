import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createEngine, type Engine } from './engine';

const wasm = readFileSync(new URL('./wasm/typst_engine_bg.wasm', import.meta.url));
const fontDir = new URL('./fonts/', import.meta.url);
const fonts = readdirSync(fontDir).map((name) => new Uint8Array(readFileSync(new URL(name, fontDir))));

describe('Engine', () => {
  let engine: Engine;
  beforeAll(async () => {
    engine = await createEngine(wasm, fonts);
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
    bare.addFont(fonts[readdirSync(fontDir).indexOf('DejaVuSansMono.ttf')]);
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
    const jump = engine.jumpFromClick(0, 5, 5);
    expect(jump).toMatchObject({ kind: 'source', path: '/main.typ' });
    if (jump?.kind !== 'source') throw new Error('expected source jump');
    expect(source.slice(jump.from, jump.to)).toBe('Hällo world');
    expect(jump.offset).toBeGreaterThanOrEqual(jump.from);
  });

  it('returns nothing for a click on empty space', () => {
    engine.setSource('/main.typ', '#set page(width: 200pt, height: 100pt, margin: 0pt)\nHi');
    engine.compile('/main.typ');
    expect(engine.jumpFromClick(0, 150, 90)).toBeNull();
  });

  it('jumps from a cursor in the source to positions in the preview', () => {
    const source = '#set page(width: 200pt, height: 100pt, margin: 0pt)\nfirst\n#pagebreak()\nsecond';
    engine.setSource('/main.typ', source);
    engine.compile('/main.typ');
    const positions = engine.jumpFromCursor('/main.typ', source.indexOf('second') + 2);
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
    expect(result.diagnostics[0].path).toBe('@preview/tiny:1.0.0/src/lib.typ');
    engine.setSource('@preview/tiny:1.0.0/src/lib.typ', '#let shout(x) = upper(x)');
    expect(engine.compile('/main.typ').diagnostics).toEqual([]);
  });

  it('rejects malformed package paths', () => {
    expect(() => engine.setSource('@preview/no-version/lib.typ', '')).toThrow(/invalid/);
  });
});
