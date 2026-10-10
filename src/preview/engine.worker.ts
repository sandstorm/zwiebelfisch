import { createEngine, type Engine } from '../engine/engine';
import type { Init, Request, Response } from './protocol';

let engine: Promise<Engine> = Promise.reject(new Error('engine worker used before init'));
engine.catch(() => {});
/** Paths pushed by the previous compile, so files deleted since are removed. */
let knownPaths = new Set<string>();

self.onmessage = async (event: MessageEvent<Init | Request>) => {
  const request = event.data;
  if (request.type === 'init') {
    engine = createEngine(request.wasm);
    return;
  }
  try {
    self.postMessage(handle(await engine, request));
  } catch (error) {
    self.postMessage({ id: request.id, type: 'error', message: String(error) } satisfies Response);
  }
};

function handle(e: Engine, request: Request): Response {
  switch (request.type) {
    case 'compile': {
      const paths = new Set(Object.keys(request.files));
      for (const path of knownPaths) if (!paths.has(path)) e.remove(path);
      for (const [path, text] of Object.entries(request.files)) e.setSource(path, text);
      knownPaths = paths;
      return { id: request.id, type: 'compile', result: e.compile(request.main) };
    }
    case 'click':
      return { id: request.id, type: 'click', jump: e.jumpFromClick(request.page, request.x, request.y) };
    case 'cursor':
      return { id: request.id, type: 'cursor', positions: e.jumpFromCursor(request.path, request.offset) };
  }
}
