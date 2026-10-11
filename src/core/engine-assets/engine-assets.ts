// The engine's static assets for the main thread: the wasm binary's URL and Typst's default fonts (the files are
// core/typst-engine's: generated into its wasm/ and fonts/). A module of its own, not part of typst-engine's entry,
// on purpose: the worker imports that entry, and a worker bundle that imported these would emit a second copy of
// every asset. Entry of core/engine-assets/. See docs/architecture/core.typ.
import type { FontInfo } from '../typst-engine/typst-engine';
import fontIndex from '../typst-engine/fonts/index.json';
import wasmUrl from '../typst-engine/wasm/typst_engine_bg.wasm?url&no-inline';

/** URL of the engine's wasm binary (pass it to `createEngine`, e.g. in a worker). */
export const ENGINE_WASM_URL: string = wasmUrl;

/** A font file by URL, with its name and faces: what the engine needs to load it lazily (`addLazyFont`). */
export interface FontFile {
  /** The file's name as the font index lists it, e.g. `NewCMMath-Book.otf`. */
  readonly name: string;
  readonly url: string;
  readonly faces: readonly FontInfo[];
}

const fontUrls = import.meta.glob<string>('../typst-engine/fonts/*.{otf,ttf}', {
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
  ([name, faces]) => ({ name, url: fontUrls[`../typst-engine/fonts/${name}`], faces }),
);
