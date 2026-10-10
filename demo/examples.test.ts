import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { createEngine, type Engine } from '../src/engine/engine';
import type { ProjectFiles } from '../src';
import { EXAMPLES, exampleFiles, exampleFromQuery, exampleQuery } from './examples';

const engineDir = new URL('../src/engine/', import.meta.url);
const wasm = readFileSync(new URL('wasm/typst_engine_bg.wasm', engineDir));
const fontDir = new URL('fonts/', engineDir);
const fonts = readdirSync(fontDir).map((name) => new Uint8Array(readFileSync(new URL(name, fontDir))));

describe('demo examples', () => {
  let engine: Engine;
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
    return engine.compile('/main.typ');
  }

  it.each(EXAMPLES.map(({ name }) => name))('%s compiles without errors or warnings', (name) => {
    const { pages, diagnostics } = compile(exampleFiles(name));
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

  it('the advanced example has a template, chapters and an SVG image given as bytes', () => {
    const files = exampleFiles('advanced');
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(['/main.typ', '/template.typ', '/chapters/introduction.typ']),
    );
    const svgs = Object.entries(files).filter(([path]) => path.endsWith('.svg'));
    expect(svgs.length).toBeGreaterThan(0);
    for (const [, content] of svgs) expect(content).toBeInstanceOf(Uint8Array);
    expect(compile(files).pages.length).toBeGreaterThan(1);
  });
});

describe('exampleFromQuery', () => {
  it.each([
    ['', 'hello'],
    ['?example=simple', 'simple'],
    ['?example=advanced&room=r&user=u', 'advanced'],
    ['?files', 'advanced'],
    ['?example=nope', 'hello'],
    ['?example=simple&files', 'simple'],
  ])('"%s" → %s', (query, name) => {
    expect(exampleFromQuery(new URLSearchParams(query))).toBe(name);
  });
});

describe('exampleQuery', () => {
  it('keeps room and user and replaces the example', () => {
    const query = exampleQuery('simple', new URLSearchParams('?example=advanced&room=r1&user=Ada'));
    expect(new URLSearchParams(query).toString()).toBe('example=simple&room=r1&user=Ada');
  });

  it('drops the legacy ?files flag', () => {
    expect(exampleQuery('hello', new URLSearchParams('?files&room=r1'))).toBe('?room=r1&example=hello');
  });
});
