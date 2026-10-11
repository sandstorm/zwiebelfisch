// Tests for plugin.ts: who may use the file API, and what each request does.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocsFolder } from './docs-folder';
import { docsFiles, handleDocsFilesRequest, type DocsFilesRequest } from './plugin';
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
    expect(await handle(request('PUT', '/?path=guide/b.typ', {}, '= B\n'))).toEqual({ status: 204, text: '' });
    expect(await readFile(join(root, 'guide/b.typ'), 'utf8')).toBe('= B\n');
    expect((await handle(request('POST', '/?path=guide/b.typ&to=c.typ'))).status).toBe(204);
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

describe('the docs-files plugin', () => {
  it('runs on the dev server only: not in a build, not in vitest', () => {
    const plugin = docsFiles({ root });
    const apply = plugin.apply as (config: object, env: { command: string; mode: string }) => boolean;
    expect(apply({}, { command: 'serve', mode: 'development' })).toBe(true);
    expect(apply({}, { command: 'build', mode: 'production' })).toBe(false);
    expect(apply({}, { command: 'serve', mode: 'test' })).toBe(false);
  });

  it('turns a change in docs/ into its event instead of Vite’s update, and leaves other files to Vite', async () => {
    const plugin = docsFiles({ root });
    const send = vi.fn();
    const invalidateModule = vi.fn();
    const context = { environment: { name: 'client', hot: { send }, moduleGraph: { invalidateModule } } };
    const hotUpdate = plugin.hotUpdate as (this: unknown, options: { file: string; modules: unknown[] }) => Promise<unknown[] | undefined>;
    await writeFile(join(root, 'a.typ'), '= Changed\n');
    expect(await hotUpdate.call(context, { file: join(root, 'a.typ'), modules: ['module'] })).toEqual([]);
    expect(invalidateModule).toHaveBeenCalledWith('module');
    expect(send).toHaveBeenCalledWith('docs-files:change', { path: 'a.typ', text: '= Changed\n' });
    expect(await hotUpdate.call(context, { file: join(base, 'main.ts'), modules: ['other'] })).toBeUndefined();
  });

  it('puts the session token into the page', () => {
    const plugin = docsFiles({ root });
    const tags = (plugin.transformIndexHtml as unknown as () => { attrs: Record<string, string> }[])();
    expect(tags[0].attrs).toMatchObject({ name: 'docs-files-token' });
    expect(tags[0].attrs.content).toMatch(/^[0-9a-f]{48}$/);
  });
});
