// The docs-files Vite plugin: while the dev server runs (`mise run demo` / `dev`, never in a build), the demo's
// Documentation example saves to docs/ and hears about changes made there by others (git, another editor). Node only.
// See docs/30_architecture/11_development.typ ("Writing the docs in the demo").
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { DocsFilesError, DocsFolder } from './docs-folder.ts';
import { DOCS_FILES_ENDPOINT, DOCS_FILES_EVENT, DOCS_FILES_HEADER, DOCS_FILES_META } from './protocol.ts';

/** The largest file the page may write (an image). */
const MAX_BYTES = 20 * 1024 * 1024;

/** A request to the endpoint, as `handleDocsFilesRequest` needs it (`url` relative to the endpoint). */
export interface DocsFilesRequest {
  method: string;
  url: string;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  /** Read only once the sender is known. */
  body(): Promise<Uint8Array>;
}

/**
 * The plugin for the docs folder `root` (`outputs`: its generated subfolders, which stay untouched). It serves the
 * file API at `DOCS_FILES_ENDPOINT` to the dev server's own page (its origin, and the session token it puts into the
 * page), and turns the watcher's events for `root` into `DOCS_FILES_EVENT`s instead of Vite's reload: the page keeps
 * its editor and applies the change itself.
 */
export function docsFiles(options: { root: string; outputs?: string[] }): Plugin {
  const folder = new DocsFolder(options.root, options.outputs);
  const token = randomBytes(24).toString('hex');
  return {
    name: 'docs-files',
    // the dev server only: not in a build, not in vitest's server
    apply: (_config, env) => env.command === 'serve' && env.mode !== 'test',
    // after Vite's own hotUpdate (the glob imports add their importer), so the list it empties is complete
    enforce: 'post',
    configureServer(server) {
      server.watcher.add(folder.root);
      server.middlewares.use(DOCS_FILES_ENDPOINT, (req, res) => void serve(folder, token, req, res));
    },
    transformIndexHtml: () => [{ tag: 'meta', attrs: { name: DOCS_FILES_META, content: token }, injectTo: 'head' }],
    async hotUpdate({ file, modules }) {
      if (!folder.contains(file)) return;
      // fresh on the next reload, but no reload now: the page applies the change (or wrote it itself)
      for (const module of modules) this.environment.moduleGraph.invalidateModule(module);
      if (this.environment.name === 'client') {
        const change = await folder.changeFor(file);
        if (change) this.environment.hot.send(DOCS_FILES_EVENT, change);
      }
      return [];
    },
  };
}

/** Answers one request: 204, or an error status with the reason as text. */
export async function handleDocsFilesRequest(folder: DocsFolder, token: string, request: DocsFilesRequest): Promise<{ status: number; text: string }> {
  try {
    checkSender(token, request.headers);
    const query = new URL(request.url, 'http://docs-files').searchParams;
    const path = query.get('path') ?? '';
    if (request.method === 'PUT') await folder.write(path, await request.body());
    else if (request.method === 'DELETE') await folder.delete(path);
    else if (request.method === 'POST') await folder.rename(path, query.get('to') ?? '');
    else throw new DocsFilesError(`${request.method} is not supported`, 405);
    return { status: 204, text: '' };
  } catch (error) {
    if (error instanceof DocsFilesError) return { status: error.status, text: error.message };
    return { status: 500, text: (error as Error).message };
  }
}

/** Only the dev server's page: from its own origin, with the token it was given. */
function checkSender(token: string, headers: DocsFilesRequest['headers']): void {
  const origin = typeof headers.origin === 'string' ? headers.origin : '';
  const host = typeof headers.host === 'string' ? headers.host : '';
  if (!origin || !host || URL.parse(origin)?.host !== host) throw new DocsFilesError('Only from the dev server’s own page', 403);
  if (headers[DOCS_FILES_HEADER] !== token) throw new DocsFilesError('Missing or wrong docs-files token', 403);
}

async function serve(folder: DocsFolder, token: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const request = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: () => readBody(req) };
  const { status, text } = await handleDocsFilesRequest(folder, token, request);
  res.statusCode = status;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new DocsFilesError(`Larger than ${MAX_BYTES} bytes`, 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
