// Tests for typst-packages.ts.
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createEngine, type TypstEngine } from '../typst-engine/typst-engine';
import { withPackages } from './typst-packages';

const wasm = readFileSync(new URL('../typst-engine/wasm/typst_engine_bg.wasm', import.meta.url));
const fontDir = new URL('../typst-engine/fonts/', import.meta.url);
const fonts = readdirSync(fontDir).map((name) => new Uint8Array(readFileSync(new URL(name, fontDir))));
const greet = new Uint8Array(readFileSync(new URL('./fixtures/greet-0.1.0.tar.gz', import.meta.url)));

const doc = '#import "@preview/greet:0.1.0": greet\n#greet("World")';

describe('withPackages', () => {
  let engine: TypstEngine;
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

  it('downloads the packages of a PDF export too, and reports failed downloads there', async () => {
    const bare = await createEngine(wasm, fonts);
    const fetchPackage = vi.fn(async (spec: string) => {
      if (spec === '@preview/greet:0.1.0') return greet;
      throw new Error('offline');
    });
    const project = withPackages(bare, fetchPackage);
    bare.setSource('/main.typ', doc);
    const { pdf, diagnostics } = await project.exportPdf('/main.typ');
    expect(diagnostics).toEqual([]);
    expect(new TextDecoder().decode(pdf!.subarray(0, 5))).toBe('%PDF-');

    bare.setSource('/main.typ', '#import "@preview/nope:1.0.0": x');
    const failed = await project.exportPdf('/main.typ');
    expect(failed.pdf).toBeNull();
    expect(failed.diagnostics).toContainEqual(expect.objectContaining({ path: null, message: expect.stringMatching(/nope.*offline/) }));
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

describe('withPackages without a fetcher', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('downloads @preview packages from packages.typst.org', async () => {
    const fetch = vi.fn(async (_url: string) => new Response(greet));
    vi.stubGlobal('fetch', fetch);
    const bare = await createEngine(wasm, fonts);
    bare.setSource('/main.typ', doc);
    expect((await withPackages(bare).compile('/main.typ')).diagnostics).toEqual([]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://packages.typst.org/preview/greet-0.1.0.tar.gz']);
  });

  it('reports HTTP errors, and packages of other namespaces as not downloadable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    const bare = await createEngine(wasm, fonts);
    const packages = withPackages(bare);
    bare.setSource('/main.typ', '#import "@preview/nope:1.0.0": x');
    expect((await packages.compile('/main.typ')).diagnostics).toContainEqual(
      expect.objectContaining({ path: null, message: expect.stringMatching(/@preview\/nope:1\.0\.0.*404/) }),
    );
    bare.setSource('/main.typ', '#import "@local/mine:1.0.0": y');
    expect((await packages.compile('/main.typ')).diagnostics).toContainEqual(
      expect.objectContaining({ path: null, message: expect.stringMatching(/@local\/mine:1\.0\.0.*only @preview/) }),
    );
  });
});
