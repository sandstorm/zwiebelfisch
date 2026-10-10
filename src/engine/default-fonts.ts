import { fetchFonts } from './fetch-fonts';

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
