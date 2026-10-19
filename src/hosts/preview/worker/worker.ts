import { DEFAULT_FONTS, ENGINE_WASM_URL } from './engine-assets';
import type { FileContent } from '../../../core/project/project';
import type { CompileResult, HtmlFile, HtmlResult, Page } from '../../../core/typst-engine/typst-engine';
import { HashedReceiver } from './hashed';
import type { EncodedFiles, EngineRequest, EngineResponse, Init, WorkerLoadEvent, WorkerProgress } from './protocol';

/**
 * The Typst engine in a Web Worker, as the preview talks to it: requests answered by id.
 *
 * Used by the preview, so compiling never blocks typing. Each request sends only the file bytes the worker doesn't
 * have yet. After a crash (a panic, memory running out) every open request is answered with the error and
 * `onDidCrash` fires; `start` starts a new worker, which knows no files yet.
 */
export class EngineWorker {
  private worker: Worker | null = null;
  private readonly pending = new Map<number, (answer: EngineAnswer) => void>();
  private nextId = 0;
  private sender = new FileSender();
  private readonly pages = new HashedReceiver<Page, 'svg'>('svg');
  private readonly htmlFiles = new HashedReceiver<HtmlFile, 'data'>('data');

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
    if (message.type === 'compile') return { ...message, result: { ...message.result, pages: this.pages.decode(message.result.pages) } };
    if (message.type === 'html') return { ...message, result: { ...message.result, files: this.htmlFiles.decode(message.result.files) } };
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
  onDidLoad(event: WorkerLoadEvent): void;
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

/** Main-thread side of a request's file map (`EncodedFiles`): remembers which bytes the worker already has. */
export class FileSender {
  private sent = new Map<string, Uint8Array>();

  encode(files: Record<string, FileContent>): EncodedFiles {
    const sent = new Map<string, Uint8Array>();
    const encoded: EncodedFiles = {};
    for (const [path, content] of Object.entries(files)) {
      if (typeof content === 'string') {
        encoded[path] = content;
        continue;
      }
      encoded[path] = this.sent.get(path) === content ? null : content;
      sent.set(path, content);
    }
    this.sent = sent;
    return encoded;
  }
}
