import { createEngine, type Engine } from '../core/typst-engine/typst-engine';
import { fetchFonts } from '../core/typst-engine/fetch-fonts';
import { withPackages, type PackageProject } from '../core/typst-engine/packages/packages';
import { FileReceiver } from './project-files';
import type { Init, Request, Response } from './protocol';

interface Session {
  engine: Engine;
  files: FileReceiver;
  packages: PackageProject;
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
    self.postMessage(await handle(await session, request));
  } catch (error) {
    self.postMessage({ id: request.id, type: 'error', message: String(error) } satisfies Response);
  }
};

async function handle({ engine, files, packages }: Session, request: Request): Promise<Response> {
  switch (request.type) {
    case 'compile':
      files.apply(request.files);
      return { id: request.id, type: 'compile', result: await packages.compile(request.main) };
    case 'click':
      return { id: request.id, type: 'click', jump: engine.jumpFromClick(request.page, request.x, request.y) };
    case 'cursor':
      return { id: request.id, type: 'cursor', positions: engine.jumpFromCursor(request.path, request.offset) };
    case 'boxes':
      return { id: request.id, type: 'boxes', boxes: engine.boxesForRanges(request.path, request.ranges) };
  }
}
