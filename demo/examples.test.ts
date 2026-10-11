// Tests that every demo example compiles without errors (examples.ts, against the built wasm), with the packages
// they import from .cache/typst-packages (mise run build:packages).
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createEngine, type TypstEngine } from '../src/core/typst-engine/typst-engine';
import { withPackages } from '../src/core/typst-packages/typst-packages';
import type { ProjectFiles } from '../src';
import { EXAMPLES, exampleFiles, exampleFromQuery, exampleQuery } from './examples';

const engineDir = new URL('../src/core/typst-engine/', import.meta.url);
const wasm = readFileSync(new URL('wasm/typst_engine_bg.wasm', engineDir));
const fontDir = new URL('fonts/', engineDir);
const fonts = readdirSync(fontDir).map((name) => new Uint8Array(readFileSync(new URL(name, fontDir))));
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
    engine = await createEngine(wasm, fonts);
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

  it.each(EXAMPLES.map(({ name }) => name))('%s compiles without errors or warnings', async (name) => {
    const { pages, diagnostics } = await compile(exampleFiles(name));
    expect(diagnostics).toEqual([]);
    expect(pages.length).toBeGreaterThan(0);
  });

  it('keeps the default document the e2e specs expect', () => {
    const files = exampleFiles('hello');
    expect(Object.keys(files)).toEqual(['/main.typ']);
    expect(files['/main.typ']).toMatch(/^#set page\(width: 16cm, height: auto, margin: 1\.5cm\)\n/);
    expect(files['/main.typ']).toContain('\n= Hello Typst\n');
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

  it('the documentation example is docs/: book, template, HTML entry and chapters, as text', () => {
    const files = exampleFiles('docs');
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['/main.typ', '/template.typ', '/site.typ', '/architecture/workbench.typ']),
    );
    for (const [path, content] of Object.entries(files)) {
      expect(path).toMatch(/\.typ$/);
      expect(typeof content).toBe('string');
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
