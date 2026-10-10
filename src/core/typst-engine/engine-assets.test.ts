// Tests for engine-assets.ts.
import { readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultFonts } from './engine-assets';

describe('defaultFonts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('fetches every bundled font file in parallel', async () => {
    const fetch = vi.fn(async (_url: string) => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetch);
    const fonts = defaultFonts();
    expect(fetch).toHaveBeenCalledTimes(readdirSync(new URL('./fonts/', import.meta.url)).length);
    expect(fetch.mock.calls.map(([url]) => url)).toContainEqual(
      expect.stringMatching(/LibertinusSerif-Regular\.otf/),
    );
    expect(await Promise.all(fonts)).toContainEqual(new Uint8Array([1, 2, 3]));
  });

  it('rejects when a font cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await expect(Promise.all(defaultFonts())).rejects.toThrow(/404/);
  });
});
