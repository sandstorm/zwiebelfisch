// The engine worker: hosts the Typst engine off the main thread and answers the preview's requests.
// See worker.ts and ARCHITECTURE.md, "Worker protocol".
import { createEngine, type Engine, fetchFonts } from '../../../core/typst-engine/typst-engine';
import { type PackageEngine, withPackages } from '../../../core/typst-packages/typst-packages';
import { FileReceiver } from './project-files';
import type { Init, Request, Response } from './protocol';

interface Session {
  engine: Engine;
  files: FileReceiver;
  packages: PackageEngine;
}

let session: Promise<Session> = Promise.reject(new Error('engine worker used before init'));
session.catch(() => {});

self.onmessage = async (event: MessageEvent<Init | Request>) => {
  const request = event.data;
  if (request.type === 'init') {
    session = createEngine(request.wasm, fetchFonts(request.fonts)).then((engine) => ({
      engine,
      files: new FileReceiver(engine),
      packages: withPackages(engine),
    }));
    return;
  }
  try {
    const response = await handle(await session, request);
    const transfer = response.type === 'pdf' && response.result.pdf ? [response.result.pdf.buffer] : [];
    self.postMessage(response, { transfer });
  } catch (error) {
    self.postMessage({ id: request.id, type: 'error', message: String(error) } satisfies Response);
  }
};

async function handle({ engine, files, packages }: Session, request: Request): Promise<Response> {
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
