// Tests for plugin.ts: who may use the file API and the event stream, and what each request does.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocsFolder } from './docs-folder';
import { docsFiles, handleDocsFilesRequest, mayStream, type DocsFilesRequest } from './plugin';
import { DOCS_FILES_HEADER } from './protocol';

const TOKEN = 'session-token';
let base: string;
let root: string;
let folder: DocsFolder;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'docs-files-'));
  root = join(base, 'docs');
  await mkdir(root);
  await writeFile(join(root, 'a.typ'), '= A\n');
  folder = new DocsFolder(root);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

function request(method: string, url: string, overrides: Partial<DocsFilesRequest> = {}, body = '') {
  const read = vi.fn(async () => new TextEncoder().encode(body));
  const headers = { host: '127.0.0.1:5199', origin: 'http://127.0.0.1:5199', [DOCS_FILES_HEADER]: TOKEN };
  return { request: { method, url, headers, body: read, ...overrides }, read };
}

const handle = (r: { request: DocsFilesRequest }) => handleDocsFilesRequest(folder, TOKEN, r.request);

describe('docs-files requests', () => {
  it('PUT writes the body, POST renames, DELETE deletes', async () => {
    expect(await handle(request('PUT', '/?path=10_guide/b.typ', {}, '= B\n'))).toEqual({ status: 204, text: '' });
    expect(await readFile(join(root, '10_guide/b.typ'), 'utf8')).toBe('= B\n');
    expect((await handle(request('POST', '/?path=10_guide/b.typ&to=c.typ'))).status).toBe(204);
    expect(await readFile(join(root, 'c.typ'), 'utf8')).toBe('= B\n');
    expect((await handle(request('DELETE', '/?path=c.typ'))).status).toBe(204);
    await expect(readFile(join(root, 'c.typ'))).rejects.toThrow();
  });

  it.each([
    ['without an Origin', { origin: undefined }],
    ['from another origin', { origin: 'http://evil.test' }],
    ['from another port', { origin: 'http://127.0.0.1:6000' }],
    ['without the token', { [DOCS_FILES_HEADER]: undefined }],
    ['with a wrong token', { [DOCS_FILES_HEADER]: 'guess' }],
  ])('refuses a request %s, before reading its body', async (_, headers) => {
    const { request: r, read } = request('PUT', '/?path=a.typ', {}, 'x');
    const result = await handleDocsFilesRequest(folder, TOKEN, { ...r, headers: { ...r.headers, ...headers } });
    expect(result.status).toBe(403);
    expect(read).not.toHaveBeenCalled();
    expect(await readFile(join(root, 'a.typ'), 'utf8')).toBe('= A\n');
  });

  it('answers the guard’s refusal with its status and reason, and other methods with 405', async () => {
    const outside = await handle(request('PUT', '/?path=../x.typ', {}, 'x'));
    expect(outside.status).toBe(400);
    expect(outside.text).toMatch(/\.\./);
    expect((await handle(request('PUT', '/', {}, 'x'))).status).toBe(400);
    expect((await handle(request('GET', '/?path=a.typ'))).status).toBe(405);
    expect((await handle(request('POST', '/?path=a.typ&to=%2Fetc%2Fx'))).status).toBe(400);
  });
});

describe('the event stream', () => {
  const headers = { host: '127.0.0.1:5199' };
  it('opens with the token in the query, from the same origin (no Origin) or the server’s own', () => {
    expect(mayStream(TOKEN, { url: `/?token=${TOKEN}`, headers })).toBe(true);
    expect(mayStream(TOKEN, { url: `/?token=${TOKEN}`, headers: { ...headers, origin: 'http://127.0.0.1:5199' } })).toBe(true);
  });

  it.each([
    ['without the token', '/', {}],
    ['with a wrong token', '/?token=guess', {}],
    ['from another origin', `/?token=${TOKEN}`, { origin: 'http://evil.test' }],
  ])('refuses %s', (_, url, extra) => {
    expect(mayStream(TOKEN, { url, headers: { ...headers, ...extra } })).toBe(false);
  });
});

describe('the docs-files plugin', () => {
  it('runs on the dev server and in vite preview (both serve): not in a build, not in vitest', () => {
    const plugin = docsFiles({ root });
    const apply = plugin.apply as (config: object, env: { command: string; mode: string }) => boolean;
    expect(apply({}, { command: 'serve', mode: 'development' })).toBe(true);
    expect(apply({}, { command: 'serve', mode: 'production' })).toBe(true);
    expect(apply({}, { command: 'build', mode: 'production' })).toBe(false);
    expect(apply({}, { command: 'serve', mode: 'test' })).toBe(false);
  });

  it('keeps a change in docs/ from Vite’s update (no reload; the page hears of it on the stream), and leaves other files to Vite', () => {
    const plugin = docsFiles({ root });
    const invalidateModule = vi.fn();
    const context = { environment: { name: 'client', moduleGraph: { invalidateModule } } };
    const hotUpdate = plugin.hotUpdate as (this: unknown, options: { file: string; modules: unknown[] }) => unknown[] | undefined;
    expect(hotUpdate.call(context, { file: join(root, 'a.typ'), modules: ['module'] })).toEqual([]);
    expect(invalidateModule).toHaveBeenCalledWith('module');
    expect(hotUpdate.call(context, { file: join(base, 'main.ts'), modules: ['other'] })).toBeUndefined();
  });

  it('puts the session token into the page', () => {
    const plugin = docsFiles({ root });
    const tags = (plugin.transformIndexHtml as unknown as () => { attrs: Record<string, string> }[])();
    expect(tags[0].attrs).toMatchObject({ name: 'docs-files-token' });
    expect(tags[0].attrs.content).toMatch(/^[0-9a-f]{48}$/);
  });

  it('in vite preview, serves the built page with the same token, and the event stream: the snapshot, then changes', async () => {
    await mkdir(join(base, 'dist'));
    await writeFile(join(base, 'dist/index.html'), '<html><head><title>Demo</title></head><body></body></html>');
    const plugin = docsFiles({ root });
    const { content: token } = (plugin.transformIndexHtml as unknown as () => { attrs: Record<string, string> }[])()[0].attrs;
    const preview = previewServer();
    await (plugin.configurePreviewServer as (server: unknown) => Promise<void>)(preview.server);

    const page = await preview.get('/?example=docs');
    expect(page.headers['content-type']).toMatch(/^text\/html/);
    expect(page.body).toContain(`<meta name="docs-files-token" content="${token}">\n</head>`);
    expect((await preview.get('/assets/main.js')).passedOn).toBe(true);

    expect((await preview.get('/__docs-files?token=guess')).status).toBe(403);
    const stream = await preview.get(`/__docs-files?token=${token}`);
    expect(stream.headers['content-type']).toBe('text/event-stream');
    expect(stream.body).toBe('event: snapshot\ndata: [{"path":"a.typ","text":"= A\\n"}]\n\n');
    await writeFile(join(root, 'b.typ'), '= B\n');
    await vi.waitFor(() => expect(stream.body).toContain('event: change\ndata: {"path":"b.typ","text":"= B\\n"}\n\n'));
    preview.close();
  });
});

/** A stand-in for Vite's preview server (root `base/demo`, out dir `../dist`): its middlewares, called as a request would. */
function previewServer() {
  const stack: { prefix: string; handle: (req: unknown, res: unknown, next: () => void) => void }[] = [];
  const closed: (() => void)[] = [];
  const server = {
    config: { root: join(base, 'demo'), build: { outDir: '../dist' } },
    middlewares: {
      use(prefix: string | ((...args: never[]) => void), handle?: (...args: never[]) => void) {
        if (typeof prefix === 'string') stack.push({ prefix, handle: handle as never });
        else stack.push({ prefix: '', handle: prefix as never });
      },
    },
    httpServer: { once: (_event: 'close', listener: () => void) => closed.push(listener) },
  };
  /** A GET to `url`: what the first middleware that takes it answers (`passedOn`: none did); a stream answers what it has sent so far. */
  async function get(url: string) {
    const response = { status: 200, headers: {} as Record<string, string>, body: '', passedOn: false };
    const req = { method: 'GET', url, headers: { host: '127.0.0.1:5199' }, [Symbol.asyncIterator]: async function* () {} };
    for (const { prefix, handle } of stack) {
      if (!url.startsWith(prefix)) continue;
      let next = false;
      const done = new Promise<void>((resolve) => {
        const res = {
          set statusCode(status: number) {
            response.status = status;
          },
          setHeader: (name: string, value: string) => (response.headers[name] = value),
          writeHead: (status: number, headers: Record<string, string>) => Object.assign(response, { status, headers }),
          write: (chunk: string) => {
            response.body += chunk;
            resolve();
          },
          end: (chunk = '') => {
            response.body += chunk;
            resolve();
          },
          once: () => {},
        };
        handle({ ...req, url: url.slice(prefix.length) || '/' }, res, () => {
          next = true;
          resolve();
        });
      });
      await done;
      if (!next) return response;
    }
    return { ...response, passedOn: true };
  }
  return { server, get, close: () => closed.forEach((listener) => listener()) };
}
