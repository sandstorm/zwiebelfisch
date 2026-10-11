/**
 * Starts the engine worker, the Typst engine off the main thread; send it `Init` first.
 *
 * A compile takes long enough to stall typing, and the engine's wasm is large. So the preview runs the engine in a
 * Web Worker, and the editors never wait for it. The worker downloads the wasm itself and compiles it while it
 * arrives (download.ts). It then answers the preview's requests by id (protocol.ts) and tells, unasked, how loading
 * goes. Each request carries the project's files; bytes the worker already has are not sent again (project-files.ts).
 * engine.worker.ts is the worker itself, and nothing on the main thread imports it. The engine and its packages are
 * core's (`core/typst-engine`, `core/typst-packages`). See docs/30_architecture/06_preview.typ, "Concepts".
 */
export function startEngineWorker(): Worker {
  return new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
}
