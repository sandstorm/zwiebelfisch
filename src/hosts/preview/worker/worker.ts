// The preview's engine worker, seen from the main thread: starting it. Its messages are protocol.ts,
// project-files.ts sends each file's bytes across only once; engine.worker.ts is the worker itself
// (nothing on the main thread imports it).
/** Starts the engine worker; send it `Init` first. */
export function startEngineWorker(): Worker {
  return new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
}
