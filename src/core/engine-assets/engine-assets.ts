import type { FontInfo } from '../typst-engine/typst-engine';
import fontIndex from '../typst-engine/fonts.gen/index.json';
import wasmUrl from '../typst-engine/wasm.gen/typst_engine_bg.wasm?url&no-inline';

/**
 * URL of the engine's wasm binary, for `createEngine` (the preview hands it to its worker).
 *
 * Import it on the main thread only: a worker bundle that imports this module emits a second copy of the wasm and
 * of every font.
 */
export const ENGINE_WASM_URL: string = wasmUrl;

/** A font file by URL, with its name and faces: what the engine needs to load it lazily (`addLazyFont`). */
export interface FontFile {
  /** The file's name as the font index lists it, e.g. `NewCMMath-Book.otf`. */
  readonly name: string;
  readonly url: string;
  readonly faces: readonly FontInfo[];
}

const fontUrls = import.meta.glob<string>('../typst-engine/fonts.gen/*.{otf,ttf}', {
  query: '?url&no-inline',
  import: 'default',
  eager: true,
});

/**
 * Typst's default fonts (Libertinus Serif, New Computer Modern + Math, DejaVu Sans Mono) as separate static assets,
 * with their faces from the index. `mise run build:fonts` copies them from the pinned typst-assets crate and writes
 * the index; the bundler emits one file each and inlines the index (16 KB).
 */
export const DEFAULT_FONTS: readonly FontFile[] = Object.entries(fontIndex as Record<string, FontInfo[]>).map(
  ([name, faces]) => ({ name, url: fontUrls[`../typst-engine/fonts.gen/${name}`], faces }),
);
