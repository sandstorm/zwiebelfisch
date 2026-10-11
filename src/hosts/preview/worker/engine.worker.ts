// The engine worker: hosts the Typst engine off the main thread and answers the preview's requests.
// See worker.ts and docs/architecture/preview.typ.
import { createEngine, type TypstEngine } from '../../../core/typst-engine/typst-engine';
import { type PackageEngine, withPackages } from '../../../core/typst-packages/typst-packages';
import { FileReceiver } from './project-files';
import type { Init, EngineRequest, EngineResponse } from './protocol';

interface Session {
  engine: TypstEngine;
  files: FileReceiver;
  packages: PackageEngine;
}

let session: Promise<Session> = Promise.reject(new Error('engine worker used before init'));
session.catch(() => {});

self.onmessage = async (event: MessageEvent<Init | EngineRequest>) => {
  const request = event.data;
  if (request.type === 'init') {
    session = createEngine(request.wasm).then((engine) => {
      for (const { url, faces } of request.fonts) engine.addLazyFont({ faces, load: () => loadSync(url) });
      return { engine, files: new FileReceiver(engine), packages: withPackages(engine) };
    });
    return;
  }
  try {
    const response = await handle(await session, request);
    const transfer = response.type === 'pdf' && response.result.pdf ? [response.result.pdf.buffer] : [];
    self.postMessage(response, { transfer });
  } catch (error) {
    self.postMessage({ id: request.id, type: 'error', message: String(error) } satisfies EngineResponse);
  }
};

async function handle({ engine, files, packages }: Session, request: EngineRequest): Promise<EngineResponse> {
  switch (request.type) {
    case 'compile':
      return { id: request.id, type: 'compile', result: await files.update(request.files, () => packages.compile(request.main)) };
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

/**
 * A font file's data, downloaded synchronously: the engine asks for it in the middle of a compile and cannot wait.
 * Allowed in a worker (and only there); the worker has nothing else to do meanwhile.
 */
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
