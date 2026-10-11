// The engine worker in-process, for measuring typing in Node (no Web Workers there). See typing.perf.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createEngine, type FontInfo, type TypstEngine } from '../../src/core/typst-engine/typst-engine';
import { type PackageEngine, withPackages } from '../../src/core/typst-packages/typst-packages';

// from the repository, where mise runs tasks (import.meta.url is no file URL under jsdom)
const engineDir = join(process.cwd(), 'src/core/typst-engine');
const packageCache = join(process.cwd(), '.cache/typst-packages');

/**
 * Stands in for the preview's Web Worker: answers its requests with the real engine on this thread. What runs here
 * runs on the worker's thread in a browser, so `engineThread` keeps it apart (a CPU profile shows it under that
 * function; `time` sums it). Messages are copied both ways (`structuredClone`, as `postMessage` does) and answered in
 * a later task, as a worker's are.
 */
export class InProcessWorker {
  /** Milliseconds spent answering requests, over all workers: what a browser spends on the worker's thread. */
  static time = 0;
  /** Requests not answered yet, over all workers. */
  static waiting = 0;
  /** Compiles answered, over all workers. */
  static compiles = 0;
  onmessage: ((event: MessageEvent) => void) | null = null;
  private session: Promise<Session> | null = null;
  private static last: Promise<Session> | null = null;

  /** The page (0-based) where offset `offset` of `path` is drawn, in the last compile of the last worker started. */
  static async pageOf(path: string, offset: number): Promise<number> {
    const { engine } = await InProcessWorker.last!;
    return engine.jumpFromCursor(path, offset as never)[0]?.page ?? 0;
  }

  postMessage(message: Request): void {
    const request = structuredClone(message);
    if (request.type === 'init') {
      this.session = start();
      InProcessWorker.last = this.session;
      return;
    }
    void this.answer(request);
  }

  terminate(): void {
    this.onmessage = null;
  }

  private async answer(request: Exclude<Request, { type: 'init' }>): Promise<void> {
    InProcessWorker.waiting++;
    const session = await this.session!;
    const started = performance.now();
    const response = structuredClone(await engineThread(session, request));
    InProcessWorker.time += performance.now() - started;
    if (request.type === 'compile') InProcessWorker.compiles++;
    setTimeout(() => {
      InProcessWorker.waiting--;
      this.onmessage?.({ data: response } as MessageEvent);
    }, 0);
  }
}

/** The preview's messages to its worker (the shape of worker/protocol.ts, which is internal to the preview). */
type Request =
  | { type: 'init' }
  | { id: number; type: 'compile'; files: Record<string, string | Uint8Array | null>; main: string }
  | { id: number; type: 'boxes'; path: string; ranges: { from: number; to: number }[] }
  | { id: number; type: 'cursor'; path: string; offset: number }
  | { id: number; type: 'click' | 'pdf' };

interface Session {
  engine: TypstEngine;
  packages: PackageEngine;
  known: Set<string>;
  /** The hashes of the pages last answered: their SVG is left out next time (PageSender). */
  sent: Set<string>;
}

async function start(): Promise<Session> {
  // the packages are unpacked from a Blob's stream, which jsdom's Blob lacks (it has FileReader)
  Blob.prototype.stream ??= function stream(this: Blob) {
    const reader = new FileReader();
    reader.readAsArrayBuffer(this);
    return new ReadableStream({
      start: (controller) => {
        reader.onload = () => {
          controller.enqueue(new Uint8Array(reader.result as ArrayBuffer));
          controller.close();
        };
      },
    });
  };
  const engine = await createEngine(readFileSync(join(engineDir, 'wasm/typst_engine_bg.wasm')));
  const fonts: Record<string, FontInfo[]> = JSON.parse(readFileSync(join(engineDir, 'fonts/index.json'), 'utf8'));
  for (const [name, faces] of Object.entries(fonts)) {
    engine.addLazyFont({ name, faces, load: () => new Uint8Array(readFileSync(join(engineDir, 'fonts', name))) });
  }
  // the packages `mise run build:packages` cached; no network
  const packages = withPackages(engine, async (spec) => {
    const [name, version] = spec.replace('@preview/', '').split(':');
    return new Uint8Array(readFileSync(join(packageCache, `${name}-${version}.tar.gz`)));
  });
  return { engine, packages, known: new Set(), sent: new Set() };
}

/** What the worker's thread does for `request` (as engine.worker.ts, files kept as FileReceiver does). */
async function engineThread(session: Session, request: Exclude<Request, { type: 'init' }>): Promise<unknown> {
  const { engine } = session;
  switch (request.type) {
    case 'compile':
      return { id: request.id, type: 'compile', result: await compile(session, request.files, request.main) };
    case 'boxes':
      return { id: request.id, type: 'boxes', boxes: engine.boxesForRanges(request.path, request.ranges as never) };
    case 'cursor':
      return { id: request.id, type: 'cursor', positions: engine.jumpFromCursor(request.path, request.offset as never) };
    default:
      return { id: request.id, type: 'error', message: `not measured: ${request.type}` };
  }
}

/** A compile of `files`, the pages the preview has without their SVG (as engine.worker.ts answers). */
async function compile({ engine, packages, known, sent }: Session, files: Record<string, string | Uint8Array | null>, main: string): Promise<unknown> {
  for (const path of known) if (!(path in files)) engine.remove(path);
  known.clear();
  for (const [path, content] of Object.entries(files)) {
    known.add(path);
    if (typeof content === 'string') engine.setSource(path, content);
    else if (content) engine.setBinary(path, content);
  }
  const result = await packages.compile(main);
  if (result.pages.length === 0) return result;
  const pages = result.pages.map((page) => (sent.has(page.hash) ? { ...page, svg: null } : page));
  sent.clear();
  for (const page of result.pages) sent.add(page.hash);
  return { ...result, pages };
}
