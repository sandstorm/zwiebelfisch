// downloadWasm. See engine.worker.ts and docs/30_architecture/06_preview.typ.

/**
 * Fetches the wasm at `url` and returns a response whose body is the download as it arrives, counted for `onProgress`,
 * served as `application/wasm`: `WebAssembly.instantiateStreaming` (wasm-bindgen's `init`) compiles while it downloads.
 * Rejects with the HTTP status when the server refuses.
 *
 * `total` is the `Content-Length` when the body comes as sent; a compressed body (`Content-Encoding`) arrives
 * decompressed, larger than its length, so then `total` is null, as it is when more arrives than announced.
 *
 * The engine's wasm as a streamed response that reports how much has arrived, so the preview can show the download
 * while the browser compiles the module as it comes in.
 */
export async function downloadWasm(url: string, onProgress: DownloadListener, fetcher: typeof fetch = fetch): Promise<Response> {
  const response = await fetcher(url);
  if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
  const encoding = response.headers.get('Content-Encoding');
  const length = Number(response.headers.get('Content-Length'));
  const announced = (!encoding || encoding === 'identity') && length > 0 ? length : null;
  let loaded = 0;
  let reported = -Infinity;
  const report = (now: number) => {
    reported = now;
    onProgress(loaded, announced !== null && loaded <= announced ? announced : null);
  };
  report(Date.now());
  const counted = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        loaded += chunk.byteLength;
        const now = Date.now();
        if (now - reported >= REPORT_INTERVAL_MS) report(now);
        controller.enqueue(chunk);
      },
      flush: () => report(Date.now()),
    }),
  );
  return new Response(counted, { status: response.status, headers: { 'Content-Type': 'application/wasm' } });
}

/** How much of a download has arrived: bytes so far, and of how many (null: unknown). */
export type DownloadListener = (loaded: number, total: number | null) => void;

/** Minimum time between two reports while bytes arrive (the last one always comes). */
const REPORT_INTERVAL_MS = 100;
