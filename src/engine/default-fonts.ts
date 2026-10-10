/**
 * Typst's default fonts (Libertinus Serif, New Computer Modern + Math,
 * DejaVu Sans Mono) as separate static assets. `mise run build:fonts` copies
 * them from the pinned typst-assets crate; the bundler emits one file each.
 */
const fontUrls = import.meta.glob<string>('./fonts/*.{otf,ttf}', {
  query: '?url',
  import: 'default',
  eager: true,
});

/** Starts downloading every default font at once; pass the result to `createEngine`. */
export function defaultFonts(): Promise<Uint8Array>[] {
  return Object.values(fontUrls).map(fetchFont);
}

async function fetchFont(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`font ${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
