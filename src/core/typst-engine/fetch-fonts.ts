// fetchFonts: downloads the font files that createEngine takes. See typst-engine.ts.
/** Starts downloading every font at once; pass the result to `createEngine`. */
export function fetchFonts(urls: readonly string[]): Promise<Uint8Array>[] {
  return urls.map(fetchFont);
}

async function fetchFont(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`font ${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
