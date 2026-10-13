import { DEFAULT_FONTS, ENGINE_WASM_URL } from '../../../core/engine-assets/engine-assets';
import type { FileContent } from '../../../core/project/project';
import type { CompileResult, HtmlResult } from '../../../core/typst-engine/typst-engine';
import { FileSender } from './project-files';
import { PageReceiver } from './page-svgs';
import { HtmlFileReceiver } from './html-files';
import type { EngineRequest, EngineResponse, Init, LoadEvent, WorkerProgress } from './protocol';

/**
 * The engine worker, the Typst engine off the main thread, as the preview talks to it: requests answered by id.
 *
 * A compile takes long enough to stall typing, and the engine's wasm is large. So the preview runs the engine in a
 * Web Worker, and the editors never wait for it. The worker downloads the wasm itself and compiles it while it
 * arrives (download.ts). It then answers the preview's requests by id (protocol.ts) and tells, unasked, how loading
 * goes. Each request carries the project's files; bytes the worker already has are not sent again (project-files.ts),
 * nor are the SVGs of pages the preview has (page-svgs.ts).
 *
 * The engine crashes on a bug in Typst or in it (a panic) or when its memory runs out, and answers nothing any more
 * after that. Then this stops the worker, answers every open request with the error and tells `onDidCrash`; `start`
 * starts a new one, which knows no files yet. engine.worker.ts is the worker itself, and nothing on the main thread
 * imports it. The engine and its packages are core's (`core/typst-engine`, `core/typst-packages`). See
 * docs/40_architecture/06_preview.typ, "Concepts".
 */
export class EngineWorker {
  private worker: Worker | null = null;
  private readonly pending = new Map<number, (answer: EngineAnswer) => void>();
  private nextId = 0;
  private sender = new FileSender();
  private readonly receiver = new PageReceiver();
  private readonly htmlReceiver = new HtmlFileReceiver();

  /** Starts the worker; `listener` hears how loading goes and when the engine crashed. */
  constructor(private readonly listener: EngineWorkerListener) {
    this.start();
  }

  /** Starts a worker, unless one runs (after a crash none does). Returns whether it started one. */
  start(): boolean {
    if (this.worker) return false;
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    this.sender = new FileSender();
    worker.onmessage = (event: MessageEvent<EngineResponse | WorkerProgress>) => this.receive(event.data);
    // an error the worker's code did not catch, or a message that could not be copied: the worker is in no known state
    worker.onerror = (event) => {
      event.preventDefault();
      this.crashed(event.message || 'The engine worker failed.');
    };
    worker.onmessageerror = () => this.crashed('A message of the engine worker could not be read.');
    worker.postMessage({ type: 'init', wasm: ENGINE_WASM_URL, fonts: DEFAULT_FONTS } satisfies Init);
    return true;
  }

  /** Asks the engine; while no worker runs (after a crash), the answer is an error right away. */
  request(request: EngineCall): Promise<EngineAnswer> {
    const worker = this.worker;
    const id = this.nextId++;
    if (!worker) return Promise.resolve({ id, type: 'error', message: 'The Typst compiler is not running.', crashed: false });
    const message: EngineRequest = request.type === 'compile' || request.type === 'html' ? { ...request, files: this.sender.encode(request.files), id } : { ...request, id };
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      worker.postMessage(message);
    });
  }

  dispose(): void {
    this.stop('The preview was closed.', false);
  }

  private receive(message: EngineResponse | WorkerProgress): void {
    if (message.type === 'progress') {
      this.listener.onDidLoad(message.event);
      return;
    }
    const resolve = this.pending.get(message.id);
    this.pending.delete(message.id);
    resolve?.(this.decode(message));
    if (message.type === 'error' && message.crashed) this.crashed(message.message);
  }

  private decode(message: EngineResponse): EngineAnswer {
    if (message.type === 'compile') return { ...message, result: { ...message.result, pages: this.receiver.decode(message.result.pages) } };
    if (message.type === 'html') return { ...message, result: { ...message.result, files: this.htmlReceiver.decode(message.result.files) } };
    return message;
  }

  private crashed(message: string): void {
    if (!this.worker) return;
    this.stop(message, true);
    this.listener.onDidCrash(message);
  }

  /** Ends the worker and answers its open requests with `message`. */
  private stop(message: string, crashed: boolean): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [id, resolve] of this.pending) resolve({ id, type: 'error', message, crashed });
    this.pending.clear();
  }
}

export interface EngineWorkerListener {
  /** The worker told how loading goes. */
  onDidLoad(event: LoadEvent): void;
  /** The engine crashed (`message` says why) and its worker was stopped. */
  onDidCrash(message: string): void;
}

/** A request without its id; a compile with the project's files as they are. */
export type EngineCall =
  | { type: 'compile' | 'html'; files: Record<string, FileContent>; main: string }
  | WithoutId<Exclude<EngineRequest, { type: 'compile' | 'html' }>>;

type WithoutId<R> = R extends unknown ? Omit<R, 'id'> : never;

/** An answer of the engine; a compile's with every page's SVG, an HTML compile's with every file's data. */
export type EngineAnswer =
  | Exclude<EngineResponse, { type: 'compile' | 'html' }>
  | { id: number; type: 'compile'; result: CompileResult; memoryInUse: number }
  | { id: number; type: 'html'; result: HtmlResult; memoryInUse: number };
