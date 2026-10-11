import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';

/**
 * A request listener for `node:http` that serves the files under `root` as they are: `GET` and `HEAD`, `/` is
 * `index.html`, anything else is 404. Its promise settles once the response is written.
 *
 * The Docker image runs the playground without Vite (no dev dependencies in it): the playground server serves the
 * built demo (`dist/demo`, `mise run build:demo`) itself, on the port Vite would use. Vite's content-hashed files under
 * `assets/` are cached for good, everything else is revalidated. The docs-files plugin is not there, so the
 * Documentation example saves nothing (the playground bar says so). See docs/30_architecture/11_development.typ.
 */
export function staticFiles(root: string): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const base = resolve(root);
  return async (request, response) => {
    const file = await staticFile(base, request.method ?? 'GET', request.url ?? '/');
    if ('status' in file) {
      response.writeHead(file.status, { 'Content-Type': 'text/plain; charset=utf-8' });
      return void response.end(file.text);
    }
    response.writeHead(200, { 'Content-Type': file.type, 'Content-Length': file.size, 'Cache-Control': file.cache });
    if (request.method === 'HEAD') return void response.end();
    // the client went away, or the file did: pipeline has closed the response already
    await pipeline(createReadStream(file.path), response).catch(() => undefined);
  };
}

/** The file a request asks for, or the error to answer with. */
async function staticFile(base: string, method: string, url: string): Promise<StaticFile | { status: number; text: string }> {
  if (method !== 'GET' && method !== 'HEAD') return { status: 405, text: 'Method not allowed' };
  const path = filePath(base, url);
  const info = path ? await stat(path).catch(() => null) : null;
  if (!path || !info?.isFile()) return { status: 404, text: 'Not found' };
  return {
    path,
    size: info.size,
    type: TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    cache: path.startsWith(join(base, 'assets', sep)) ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
}

interface StaticFile {
  path: string;
  size: number;
  type: string;
  cache: string;
}

/** The file under `base` that `url` names, or null when it names none (bad encoding, outside `base`). */
function filePath(base: string, url: string): string | null {
  const pathname = URL.parse(url, 'http://static')?.pathname ?? '/';
  try {
    // join normalises `..`; whatever ends up outside `base` is not ours to serve
    const path = join(base, decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
    return path.startsWith(base + sep) ? path : null;
  } catch {
    return null;
  }
}

/** The types of what a Vite build of the demo contains (WebAssembly must be `application/wasm` to stream). */
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};
