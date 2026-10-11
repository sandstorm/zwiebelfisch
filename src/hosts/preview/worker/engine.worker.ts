// The engine worker's own thread: answers the preview's requests. See EngineWorker in worker.ts.
import { createEngine, type TypstEngine, TypstEngineCrash } from '../../../core/typst-engine/typst-engine';
import { type PackageEngine, withPackages } from '../../../core/typst-packages/typst-packages';
import { downloadWasm } from './download';
import { FileReceiver } from './project-files';
import { PageSender } from './page-svgs';
import type { Init, EngineRequest, EngineResponse, LoadEvent, WorkerProgress } from './protocol';

interface Session {
  engine: TypstEngine;
  files: FileReceiver;
  pages: PageSender;
  packages: PackageEngine;
}

let session: Promise<Session> = Promise.reject(new Error('engine worker used before init'));
session.catch(() => {});

self.onmessage = async (event: MessageEvent<Init | EngineRequest>) => {
  const request = event.data;
  if (request.type === 'init') {
    const wasm = downloadWasm(request.wasm, (loaded, total) => tell({ kind: 'engine', loaded, total }));
    session = createEngine(wasm).then((engine) => {
      for (const { name, url, faces } of request.fonts) engine.addLazyFont({ name, faces, load: () => loadFont(name, url) });
      tell({ kind: 'ready' });
      return { engine, files: new FileReceiver(engine), pages: new PageSender(), packages: withPackages(engine, undefined, (specs) => tell({ kind: 'packages', specs })) };
    });
    session.catch((error: unknown) => tell({ kind: 'failed', message: error instanceof Error ? error.message : String(error) }));
    return;
  }
  try {
    const response = await handle(await session, request);
    const transfer = response.type === 'pdf' && response.result.pdf ? [response.result.pdf.buffer] : [];
    self.postMessage(response, { transfer });
  } catch (error) {
    const crashed = error instanceof TypstEngineCrash;
    self.postMessage({ id: request.id, type: 'error', message: crashed ? error.message : String(error), crashed } satisfies EngineResponse);
  }
};

async function handle({ engine, files, pages, packages }: Session, request: EngineRequest): Promise<EngineResponse> {
  switch (request.type) {
    case 'compile': {
      const result = await files.update(request.files, () => packages.compile(request.main));
      return { id: request.id, type: 'compile', result: { ...result, pages: pages.encode(result.pages) }, memoryInUse: engine.memoryInUse };
    }
    case 'pdf':
      return { id: request.id, type: 'pdf', result: await files.withSources(request.sources, () => packages.exportPdf(request.main)) };
    case 'click':
      return { id: request.id, type: 'click', jump: engine.jumpFromClick(request.page, request.x, request.y) };
    case 'cursor':
      return { id: request.id, type: 'cursor', positions: engine.jumpFromCursor(request.path, request.offset) };
    case 'boxes':
      return { id: request.id, type: 'boxes', boxes: engine.boxesForRanges(request.path, request.ranges) };
  }
}

/** Tells the preview how loading goes (the main thread gets it while this thread still works). */
function tell(event: LoadEvent): void {
  self.postMessage({ type: 'progress', event } satisfies WorkerProgress);
}

/**
 * A font file's data, downloaded synchronously: the engine asks for it in the middle of a compile and cannot wait.
 * Allowed in a worker (and only there); the worker has nothing else to do meanwhile.
 */
function loadFont(name: string, url: string): Uint8Array | null {
  tell({ kind: 'font', name });
  try {
    return loadSync(url);
  } finally {
    tell({ kind: 'font', name: null });
  }
}

function loadSync(url: string): Uint8Array | null {
  const request = new XMLHttpRequest();
  request.open('GET', url, false);
  request.responseType = 'arraybuffer';
  try {
    request.send();
  } catch (error) {
    console.error(`font ${url}: ${String(error)}`);
    return null;
  }
  if (request.status === 200) return new Uint8Array(request.response as ArrayBuffer);
  console.error(`font ${url}: HTTP ${request.status}`);
  return null;
}
