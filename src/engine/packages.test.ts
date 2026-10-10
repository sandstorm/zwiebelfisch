import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEngine, type Engine } from './engine';
import { fetchPreviewPackage, withPackages } from './packages';

const wasm = readFileSync(new URL('./wasm/typst_engine_bg.wasm', import.meta.url));
const fontDir = new URL('./fonts/', import.meta.url);
const fonts = readdirSync(fontDir).map((name) => new Uint8Array(readFileSync(new URL(name, fontDir))));
const greet = new Uint8Array(readFileSync(new URL('./fixtures/greet-0.1.0.tar.gz', import.meta.url)));

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
  const drafting = new Uint8Array(readFileSync(new URL('./fixtures/drafting-0.2.2.tar.gz', import.meta.url)));

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
});
