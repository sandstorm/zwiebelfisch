import { createEngine } from '../engine/engine';
import { defaultFonts } from '../engine/default-fonts';
import wasmUrl from '../engine/wasm/typst_engine_bg.wasm?url';
import type { Request, Response } from './protocol';

const engine = createEngine(wasmUrl, defaultFonts());
/** Paths pushed by the previous compile, so files deleted since are removed. */
let knownPaths = new Set<string>();

self.onmessage = async (event: MessageEvent<Request>) => {
  const request = event.data;
  try {
    self.postMessage(handle(await engine, request));
  } catch (error) {
    self.postMessage({ id: request.id, type: 'error', message: String(error) } satisfies Response);
  }
};

function handle(e: Awaited<typeof engine>, request: Request): Response {
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
