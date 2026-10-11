// Tests for staticFiles (static-files.ts): a folder like dist/demo, served in-process (no port).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import { staticFiles } from './static-files.ts';

const parent = mkdtempSync(join(tmpdir(), 'static-files-'));
const root = join(parent, 'demo');
mkdirSync(join(root, 'assets'), { recursive: true });
writeFileSync(join(root, 'index.html'), '<!doctype html><title>demo</title>');
writeFileSync(join(root, 'assets', 'engine-abc123.wasm'), new Uint8Array([0, 97, 115, 109]));
writeFileSync(join(root, 'assets', 'a b.js'), 'export {};');
writeFileSync(join(parent, 'secret.txt'), 'not served');
const serve = staticFiles(root);

afterAll(() => rmSync(parent, { recursive: true, force: true }));

/** What the listener answers to `method` `url` (sent as it is: no `..` resolved before). */
async function get(url: string, method = 'GET') {
  const answer = { status: 0, headers: {} as Record<string, string | number>, body: Buffer.alloc(0) };
  const chunks: Buffer[] = [];
  const response = Object.assign(new PassThrough(), {
    writeHead: (status: number, headers: Record<string, string | number>) => Object.assign(answer, { status, headers }),
  });
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  const ended = new Promise((done) => response.on('end', done));
  await serve({ method, url } as IncomingMessage, response as unknown as ServerResponse);
  await ended;
  return { ...answer, body: Buffer.concat(chunks) };
}

describe('staticFiles', () => {
  it('serves index.html for / and revalidates it', async () => {
    const response = await get('/?room=playground-hello&user=Ann');
    expect(response.status).toBe(200);
    expect(response.headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(response.headers['Cache-Control']).toBe('no-cache');
    expect(response.body.toString()).toBe('<!doctype html><title>demo</title>');
  });

  it('serves the hashed assets as WebAssembly and JavaScript, cached for good', async () => {
    const wasm = await get('/assets/engine-abc123.wasm');
    expect(wasm.headers['Content-Type']).toBe('application/wasm');
    expect(wasm.headers['Content-Length']).toBe(4);
    expect(wasm.headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
    expect([...wasm.body]).toEqual([0, 97, 115, 109]);
    const script = await get('/assets/a%20b.js');
    expect(script.headers['Content-Type']).toBe('text/javascript; charset=utf-8');
    expect(script.body.toString()).toBe('export {};');
  });

  it('answers HEAD without a body', async () => {
    const response = await get('/index.html', 'HEAD');
    expect(response.status).toBe(200);
    expect(response.headers['Content-Length']).toBe(34);
    expect(response.body.length).toBe(0);
  });

  it('answers 404 for missing files, folders and paths outside the root', async () => {
    for (const url of ['/missing.js', '/assets', '/../secret.txt', '/%2e%2e/secret.txt', '/assets/%2e%2e/%2e%2e/secret.txt', '/%E0%A4%A']) {
      expect((await get(url)).status, url).toBe(404);
    }
  });

  it('answers 405 to anything but GET and HEAD', async () => {
    expect((await get('/index.html', 'POST')).status).toBe(405);
  });
});
