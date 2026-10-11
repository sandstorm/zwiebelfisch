// The docs-files Vite plugin: while the dev server (`mise run demo` / `dev`) or `vite preview` (`mise run demo:build`)
// runs, never in a build, the demo's Documentation example saves to docs/ and hears about changes made there by others
// (a checkout, another editor). Node only. See docs/30_architecture/11_development.typ ("Writing the docs in the demo").
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { Connect, Plugin } from 'vite';
import { DocsFilesError, DocsFolder } from './docs-folder.ts';
import { DOCS_FILES_CHANGE, DOCS_FILES_ENDPOINT, DOCS_FILES_HEADER, DOCS_FILES_META, DOCS_FILES_SNAPSHOT, DOCS_FILES_TOKEN_PARAM } from './protocol.ts';

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
 * The plugin for the docs folder `root`. It serves the
 * file API and the event stream of changes on disk at `DOCS_FILES_ENDPOINT` to the server's own page (its origin, and
 * the session token it puts into the page), the same on the dev server and in `vite preview`. On the dev server, a
 * change in `root` is no reload: the page keeps its editor and applies the change itself.
 */
export function docsFiles(options: { root: string }): Plugin {
  const folder = new DocsFolder(options.root);
  const token = randomBytes(24).toString('hex');
  const meta = { tag: 'meta', attrs: { name: DOCS_FILES_META, content: token }, injectTo: 'head' } as const;
  return {
    name: 'docs-files',
    // the dev server and `vite preview` (both `serve`): not in a build, not in vitest's server
    apply: (_config, env) => env.command === 'serve' && env.mode !== 'test',
    // after Vite's own hotUpdate (the glob imports add their importer), so the list it empties is complete
    enforce: 'post',
    configureServer(server) {
      // the glob imports of docs/ see files made there (the next reload has them)
      server.watcher.add(folder.root);
      new DocsEndpoint(folder, token).serve(server.middlewares, server.httpServer);
    },
    configurePreviewServer(server) {
      new DocsEndpoint(folder, token).serve(server.middlewares, server.httpServer);
      // the built page has no token (a build leaves the plugin out): it gets it on the way out
      const page = resolve(server.config.root, server.config.build.outDir, 'index.html');
      server.middlewares.use((req, res, next) => {
        const path = new URL(req.url ?? '/', 'http://docs-files').pathname;
        if (req.method !== 'GET' || (path !== '/' && path !== '/index.html')) return next();
        readFile(page, 'utf8').then((html) => {
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.setHeader('cache-control', 'no-cache');
          res.end(html.replace('</head>', `<meta name="${meta.attrs.name}" content="${token}">\n</head>`));
        }, next);
      });
    },
    transformIndexHtml: () => [meta],
    hotUpdate({ file, modules }) {
      if (!folder.contains(file)) return;
      // fresh on the next reload, but no reload now: the page hears of the change on the event stream
      for (const module of modules) this.environment.moduleGraph.invalidateModule(module);
      return [];
    },
  };
}

/** Answers one file API request: 204, or an error status with the reason as text. */
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

/**
 * Whether a `GET` to the endpoint may open the event stream: with the token in its query, and from the server's own
 * origin if it names one (a same-origin `EventSource` sends no Origin).
 */
export function mayStream(token: string, request: Pick<DocsFilesRequest, 'url' | 'headers'>): boolean {
  const { origin, host } = request.headers;
  if (origin !== undefined && (typeof origin !== 'string' || URL.parse(origin)?.host !== host)) return false;
  return new URL(request.url, 'http://docs-files').searchParams.get(DOCS_FILES_TOKEN_PARAM) === token;
}

/** Only the server's own page: from its own origin, with the token it was given. */
function checkSender(token: string, headers: DocsFilesRequest['headers']): void {
  const origin = typeof headers.origin === 'string' ? headers.origin : '';
  const host = typeof headers.host === 'string' ? headers.host : '';
  if (!origin || !host || URL.parse(origin)?.host !== host) throw new DocsFilesError('Only from the server’s own page', 403);
  if (headers[DOCS_FILES_HEADER] !== token) throw new DocsFilesError('Missing or wrong docs-files token', 403);
}

/** The endpoint on one server: the file API, and the event stream with the watcher behind it. */
class DocsEndpoint {
  readonly #streams = new Set<ServerResponse>();

  constructor(
    private readonly folder: DocsFolder,
    private readonly token: string,
  ) {}

  /** Mounts the endpoint; the watcher and the open streams end with `httpServer`. */
  serve(middlewares: Connect.Server, httpServer: { once(event: 'close', listener: () => void): unknown } | null): void {
    const stop = this.folder.watch((change) => {
      for (const stream of this.#streams) sendEvent(stream, DOCS_FILES_CHANGE, change);
    });
    httpServer?.once('close', () => {
      stop();
      for (const stream of this.#streams) stream.end();
    });
    middlewares.use(DOCS_FILES_ENDPOINT, (req, res) => void this.#answer(req, res));
  }

  async #answer(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const request = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: () => readBody(req) };
    if (request.method === 'GET') return this.#openStream(request, res);
    const { status, text } = await handleDocsFilesRequest(this.folder, this.token, request);
    res.statusCode = status;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(text);
  }

  /** The event stream: the snapshot, then every change until the page goes away. */
  async #openStream(request: DocsFilesRequest, res: ServerResponse): Promise<void> {
    if (!mayStream(this.token, request)) {
      res.statusCode = 403;
      return void res.end('Missing or wrong docs-files token');
    }
    const snapshot = await this.folder.snapshot().catch((error: Error) => error);
    if (snapshot instanceof Error) {
      res.statusCode = 500;
      return void res.end(snapshot.message);
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    sendEvent(res, DOCS_FILES_SNAPSHOT, snapshot);
    this.#streams.add(res);
    res.once('close', () => this.#streams.delete(res));
  }
}

/** One Server-Sent Event: JSON has no line breaks, so it fits one `data:` line. */
function sendEvent(stream: ServerResponse, event: string, data: unknown): void {
  stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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
