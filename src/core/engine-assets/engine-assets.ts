// The engine's static assets as URLs for the main thread: the wasm binary and Typst's default fonts (the files
// are core/typst-engine's: generated into its wasm/ and fonts/). A module of its own, not part of typst-engine's
// entry, on purpose: the worker imports that entry, and a worker bundle that imported these would emit a second copy
// of every asset. Entry of core/engine-assets/. See docs/architecture/core.typ.
import wasmUrl from '../typst-engine/wasm/typst_engine_bg.wasm?url&no-inline';

/** URL of the engine's wasm binary (pass it to `createEngine`, e.g. in a worker). */
export const ENGINE_WASM_URL: string = wasmUrl;

/**
 * Typst's default fonts (Libertinus Serif, New Computer Modern + Math,
 * DejaVu Sans Mono) as separate static assets. `mise run build:fonts` copies
 * them from the pinned typst-assets crate; the bundler emits one file each.
 */
export const DEFAULT_FONT_URLS: readonly string[] = Object.values(
  import.meta.glob<string>('../typst-engine/fonts/*.{otf,ttf}', { query: '?url&no-inline', import: 'default', eager: true }),
);
