import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEngine, type Engine } from '../typst-engine';
import { fetchPreviewPackage, withPackages } from './packages';
import { addMarginNote } from '../../../editor/add-margin-note';
import type { TextChange } from '../../typst-document/typst-document';

const wasm = readFileSync(new URL('../wasm/typst_engine_bg.wasm', import.meta.url));
const fontDir = new URL('../fonts/', import.meta.url);
const fonts = readdirSync(fontDir).map((name) => new Uint8Array(readFileSync(new URL(name, fontDir))));
const greet = new Uint8Array(readFileSync(new URL('../fixtures/greet-0.1.0.tar.gz', import.meta.url)));

const doc = '#import "@preview/greet:0.1.0": greet\n#greet("World")';

describe('withPackages', () => {
  let engine: Engine;
  beforeAll(async () => {
    engine = await createEngine(wasm, fonts);
  });

  it('downloads an imported package once, then compiles', async () => {
    const fetchPackage = vi.fn(async (_spec: string) => greet);
    const project = withPackages(engine, fetchPackage);
    engine.setSource('/main.typ', doc);

    const first = await project.compile('/main.typ');
    expect(first.diagnostics).toEqual([]);
    expect(first.pages).toHaveLength(1);
    expect(first.missingPackages).toEqual([]);
    expect(fetchPackage.mock.calls).toEqual([['@preview/greet:0.1.0']]);

    engine.setSource('/main.typ', `${doc}\nagain`);
    expect((await project.compile('/main.typ')).diagnostics).toEqual([]);
    expect(fetchPackage).toHaveBeenCalledTimes(1);
  });

  it('reports a package that cannot be downloaded, and does not retry it', async () => {
    const bare = await createEngine(wasm, fonts);
    const fetchPackage = vi.fn(async () => {
      throw new Error('offline');
    });
    const project = withPackages(bare, fetchPackage);
    bare.setSource('/main.typ', '#import "@preview/nope:1.0.0": x');

    const { pages, diagnostics } = await project.compile('/main.typ');
    expect(pages).toEqual([]);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ path: '/main.typ', message: expect.stringContaining('package not found') }),
    );
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ path: null, message: expect.stringMatching(/@preview\/nope:1\.0\.0.*offline/) }),
    );
    await project.compile('/main.typ');
    expect(fetchPackage).toHaveBeenCalledTimes(1);
  });

  it('gives up on an archive without files instead of looping', async () => {
    const bare = await createEngine(wasm, fonts);
    const empty = new Uint8Array(new Uint8Array(await new Response(
      new Blob([new Uint8Array(1024)]).stream().pipeThrough(new CompressionStream('gzip')),
    ).arrayBuffer()));
    const project = withPackages(bare, async () => empty);
    bare.setSource('/main.typ', '#import "@preview/empty:1.0.0": x');
    const { diagnostics } = await project.compile('/main.typ');
    expect(diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringContaining('no files') }));
  });
});

describe('fetchPreviewPackage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('downloads @preview packages from packages.typst.org', async () => {
    const fetch = vi.fn(async (_url: string) => new Response(greet));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchPreviewPackage('@preview/greet:0.1.0')).toEqual(greet);
    expect(fetch.mock.calls[0][0]).toBe('https://packages.typst.org/preview/greet-0.1.0.tar.gz');
  });

  it('rejects on HTTP errors and for other namespaces', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await expect(fetchPreviewPackage('@preview/nope:1.0.0')).rejects.toThrow(/404/);
    await expect(fetchPreviewPackage('@local/mine:1.0.0')).rejects.toThrow(/@preview/);
  });
});

describe('the drafting package (margin notes)', () => {
  const drafting = new Uint8Array(readFileSync(new URL('../fixtures/drafting-0.2.2.tar.gz', import.meta.url)));

  it('compiles point and range margin notes', async () => {
    const bare = await createEngine(wasm, fonts);
    const project = withPackages(bare, async () => drafting);
    bare.setSource(
      '/main.typ',
      [
        '#import "@preview/drafting:0.2.2": margin-note',
        '#set page(margin: (x: 4cm))',
        'Some text#margin-note[Is this still right?]',
        'and #margin-note[a range][with a note] plus #margin-note(side: left)[left][note]',
      ].join('\n'),
    );
    const { pages, diagnostics } = await project.compile('/main.typ');
    expect(diagnostics).toEqual([]);
    expect(pages).toHaveLength(1);
  });

  it('compiles a note in a document without page setup', async () => {
    const bare = await createEngine(wasm, fonts);
    const project = withPackages(bare, async () => drafting);
    bare.setSource('/main.typ', '#import "@preview/drafting:0.2.2": margin-note\nText#margin-note[note]');
    expect((await project.compile('/main.typ')).diagnostics).toEqual([]);
  });

  describe('page margins (drafting 0.2.2 needs a margin that differs by side)', () => {
    const demo = readFileSync(new URL('../../../../demo/examples/hello/main.typ', import.meta.url), 'utf8');
    const compile = async (text: string) => {
      const bare = await createEngine(wasm, fonts);
      const project = withPackages(bare, async () => drafting);
      bare.setSource('/main.typ', text);
      return (await project.compile('/main.typ')).diagnostics.map((d) => d.message);
    };
    const apply = (text: string, changes: readonly TextChange[]) =>
      [...changes].sort((a, b) => b.from - a.from).reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), text);

    it('fails on the demo\'s single-length margin without the rewrite (the upstream bug)', async () => {
      const text = `#import "@preview/drafting:0.2.2": margin-note\n${demo}Note#margin-note[x]\n`;
      expect(demo).toMatch(/margin: 1\.5cm/);
      expect(await compile(text)).toEqual([expect.stringContaining('has no method `keys`')]);
    });

    it('compiles point and range notes in the demo after adding them', async () => {
      let text = demo;
      for (const at of [text.indexOf('Hello Typst') + 5, text.length - 1]) {
        text = apply(text, addMarginNote(text, { from: at, to: at })!.changes);
      }
      const word = text.indexOf('Typst', text.indexOf('= Hello'));
      text = apply(text, addMarginNote(text, { from: word, to: word + 5 })!.changes);
      expect(text).toMatch(/margin: \(right: 4cm, rest: 1\.5cm\)/);
      expect(await compile(text)).toEqual([]);
    });

    it.each(['5cm', '1in', '1cm + 5%', '(x: 2cm, y: 2cm)'])('compiles a note after rewriting margin: %s', async (margin) => {
      const text = `#set page(width: 16cm, height: auto, margin: ${margin})\nText\n`;
      expect(await compile(apply(text, addMarginNote(text, { from: text.length - 1, to: text.length - 1 })!.changes))).toEqual([]);
    });
  });
});
