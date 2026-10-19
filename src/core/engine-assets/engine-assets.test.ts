// Tests for engine-assets.ts: the default fonts, by URL with their faces from the index.
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FONTS } from './engine-assets';

describe('DEFAULT_FONTS', () => {
  it('has every bundled font file, by URL, with its faces', () => {
    const files = readdirSync(new URL('../typst-engine/fonts.gen/', import.meta.url)).filter((name) => /\.(otf|ttf)$/.test(name));
    expect(DEFAULT_FONTS.map(({ url }) => url.split('/').pop()?.replace(/\?.*$/, '')).sort()).toEqual(files.sort());
    const regular = DEFAULT_FONTS.find(({ url }) => url.includes('LibertinusSerif-Regular.otf'));
    expect(regular?.faces).toEqual([
      expect.objectContaining({ index: 0, family: 'Libertinus Serif', variant: { style: 'normal', weight: 400, stretch: 1000 } }),
    ]);
  });
});
