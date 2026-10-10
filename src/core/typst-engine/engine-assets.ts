// The engine's static assets as URLs for the main thread: the wasm binary and Typst's default
// fonts. Kept out of the entry file (typst-engine.ts) on purpose: the worker imports the entry,
// and a worker bundle that imports these would emit a second copy of every asset. A documented
// boundary exception (eslint.config.js): hosts/preview imports this file directly.
import { fetchFonts } from './fetch-fonts';
import wasmUrl from './wasm/typst_engine_bg.wasm?url&no-inline';

/** URL of the engine's wasm binary (pass it to `createEngine`, e.g. in a worker). */
export const ENGINE_WASM_URL: string = wasmUrl;

/**
 * Typst's default fonts (Libertinus Serif, New Computer Modern + Math,
 * DejaVu Sans Mono) as separate static assets. `mise run build:fonts` copies
 * them from the pinned typst-assets crate; the bundler emits one file each.
 */
export const DEFAULT_FONT_URLS: readonly string[] = Object.values(
  import.meta.glob<string>('./fonts/*.{otf,ttf}', { query: '?url&no-inline', import: 'default', eager: true }),
);

/** Starts downloading every default font at once; pass the result to `createEngine`. */
export function defaultFonts(): Promise<Uint8Array>[] {
  return fetchFonts(DEFAULT_FONT_URLS);
}
