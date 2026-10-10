// The preview's engine worker, seen from the main thread: starting it, the messages it takes and
// sends (protocol.ts), and FileSender, which sends each file's bytes across only once.
// engine.worker.ts is the worker itself; nothing on the main thread imports it.
export type { Init, Request, Response } from './protocol';
export { FileSender } from './project-files';

/** Starts the engine worker; send it `Init` first. */
export function startEngineWorker(): Worker {
  return new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
}
