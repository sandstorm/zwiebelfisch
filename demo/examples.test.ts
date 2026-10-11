// Tests that every demo example compiles without errors (examples.ts, against the built wasm), with the packages
// they import from .cache/typst-packages (mise run build:packages).
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { type FontInfo, type TypstEngine, createEngine } from '../src/core/typst-engine/typst-engine';
import { withPackages } from '../src/core/typst-packages/typst-packages';
import type { ProjectFiles } from '../src';
import { EXAMPLES, exampleFiles, exampleFromQuery, exampleQuery } from './examples';

const engineDir = new URL('../src/core/typst-engine/', import.meta.url);
const wasm = readFileSync(new URL('wasm/typst_engine_bg.wasm', engineDir));
const fontDir = new URL('fonts/', engineDir);
const fontIndex: Record<string, FontInfo[]> = JSON.parse(readFileSync(new URL('index.json', fontDir), 'utf8'));

/** An engine with the default fonts, each loaded when a compile first uses it; `loaded` lists the files loaded. */
async function engineWithFonts(loaded: string[] = []): Promise<TypstEngine> {
  const engine = await createEngine(wasm);
  for (const [name, faces] of Object.entries(fontIndex)) {
    engine.addLazyFont({ name, faces, load: () => (loaded.push(name), new Uint8Array(readFileSync(new URL(name, fontDir)))) });
  }
  return engine;
}

const packageDir = new URL('../.cache/typst-packages/', import.meta.url);

/** `@preview/name:1.0.0` from the downloads of `mise run build:packages`, as the demo would fetch it. */
async function cachedPackage(spec: string): Promise<Uint8Array> {
  const [, name, version] = /^@preview\/(.+):(.+)$/.exec(spec)!;
  return new Uint8Array(readFileSync(new URL(`${name}-${version}.tar.gz`, packageDir)));
}

describe('demo examples', () => {
  let engine: TypstEngine;
  let loaded: string[] = [];
  beforeAll(async () => {
    engine = await engineWithFonts();
  });

  /** Compiles a project on its own: the files of earlier projects are removed first. */
  function compile(files: ProjectFiles) {
    loaded.forEach((path) => engine.remove(path));
    loaded = Object.keys(files);
    for (const [path, content] of Object.entries(files)) {
      if (typeof content === 'string') engine.setSource(path, content);
      else engine.setBinary(path, content);
    }
    return withPackages(engine, cachedPackage).compile('/main.typ');
  }

  // the docs draw seven Mermaid diagrams (merman's wasm): seconds, more under a parallel test run
  it.each(EXAMPLES.map(({ name }) => name))(
    '%s compiles without errors or warnings',
    async (name) => {
      const { pages, diagnostics } = await compile(exampleFiles(name));
      expect(diagnostics).toEqual([]);
      expect(pages.length).toBeGreaterThan(0);
    },
    30_000,
  );

  it('keeps the default document the e2e specs expect', () => {
    const files = exampleFiles('hello');
    expect(Object.keys(files)).toEqual(['/main.typ']);
    expect(files['/main.typ']).toMatch(/^#set page\(width: 16cm, height: auto, margin: 1\.5cm\)\n/);
    expect(files['/main.typ']).toContain('\n= Hello Typst\n');
  });

  it('the default document loads only the fonts it uses: the first render downloads 4 of 17 font files', async () => {
    const loaded: string[] = [];
    const fresh = await engineWithFonts(loaded);
    fresh.setSource('/main.typ', exampleFiles('hello')['/main.typ'] as string);
    expect(fresh.compile('/main.typ').diagnostics).toEqual([]);
    // 2.4 MB (1.7 MB gzipped) instead of all 9.7 MB (6.4 MB gzipped)
    expect(loaded.sort()).toEqual([
      'LibertinusSerif-Bold.otf',
      'LibertinusSerif-Italic.otf',
      'LibertinusSerif-Regular.otf',
      'NewCMMath-Book.otf',
    ]);
  });

  it('the simple example is a single file', () => {
    expect(Object.keys(exampleFiles('simple'))).toEqual(['/main.typ']);
  });

  it('the advanced example has a template, chapters and an SVG image given as bytes', async () => {
    const files = exampleFiles('advanced');
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['/main.typ', '/template.typ', '/chapters/introduction.typ']),
    );
    const svgs = Object.entries(files).filter(([path]) => path.endsWith('.svg'));
    expect(svgs.length).toBeGreaterThan(0);
    for (const [, content] of svgs) expect(content).toBeInstanceOf(Uint8Array);
    expect((await compile(files)).pages.length).toBeGreaterThan(1);
  });

  it('the advanced example has an IronCalc spreadsheet, byte for byte, and its Typst file', () => {
    const files = exampleFiles('advanced');
    const onDisk = readFileSync(new URL('examples/advanced/data/compile-times.ic', import.meta.url));
    expect(files['/data/compile-times.ic']).toEqual(new Uint8Array(onDisk));
    expect(files['/data/compile-times.ic.gen.typ']).toMatch(/^\/\/ Generated from compile-times\.ic/);
  });

  it('the documentation example is docs/: book, template, HTML entry and chapters as text, the logo and the diagrams as bytes', () => {
    const files = exampleFiles('docs');
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['/main.typ', '/template.typ', '/site.typ', '/architecture/workbench.typ']),
    );
    expect(files['/assets/sandstorm-logo.svg']).toBeInstanceOf(Uint8Array);
    expect(files['/diagrams/keystroke.mmd']).toBeInstanceOf(Uint8Array);
    for (const [path, content] of Object.entries(files)) {
      if (path.endsWith('.typ')) expect(typeof content).toBe('string');
      else expect(path).toMatch(/\.(svg|mmd)$/);
    }
  });
});

describe('exampleFromQuery', () => {
  it.each([
    ['', 'hello'],
    ['?example=simple', 'simple'],
    ['?example=advanced&room=r&user=u', 'advanced'],
    ['?example=docs', 'docs'],
    ['?example=nope', 'hello'],
  ])('"%s" → %s', (query, name) => {
    expect(exampleFromQuery(new URLSearchParams(query))).toBe(name);
  });
});

describe('exampleQuery', () => {
  it('keeps room and user and replaces the example', () => {
    const query = exampleQuery('simple', new URLSearchParams('?example=advanced&room=r1&user=Ada'));
    expect(new URLSearchParams(query).toString()).toBe('example=simple&room=r1&user=Ada');
  });
});
