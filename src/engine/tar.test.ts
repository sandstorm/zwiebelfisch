import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { untarGz } from './tar';

const text = (data: Uint8Array | undefined) => new TextDecoder().decode(data);

/** A minimal ustar writer for edge cases the fixture does not cover. */
function tar(entries: { name: string; type?: string; body?: string }[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const { name, type = '0', body = '' } of entries) {
    const data = new TextEncoder().encode(body);
    const header = new Uint8Array(512);
    const put = (offset: number, value: string) => header.set(new TextEncoder().encode(value), offset);
    put(0, name);
    put(124, data.length.toString(8).padStart(11, '0'));
    put(156, type);
    put(257, 'ustar\u000000');
    blocks.push(header, data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let offset = 0;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.length;
  }
  return gzipSync(out);
}

describe('untarGz', () => {
  it('reads the files of a package archive made by a real tar (pax format)', async () => {
    const files = await untarGz(new Uint8Array(readFileSync(new URL('./fixtures/greet-0.1.0.tar.gz', import.meta.url))));
    expect([...files.keys()].sort()).toEqual([
      'lib.typ',
      'src/a-directory-with-a-rather-long-name-so-that-the-whole-path-is-longer-than-one-hundred-bytes/words.typ',
      'typst.toml',
    ]);
    expect(text(files.get('typst.toml'))).toContain('name = "greet"');
  });

  it('skips directories and strips a leading ./', async () => {
    const files = await untarGz(tar([{ name: './dir/', type: '5' }, { name: './dir/a.typ', body: 'A' }]));
    expect([...files.keys()]).toEqual(['dir/a.typ']);
    expect(text(files.get('dir/a.typ'))).toBe('A');
  });

  it('uses GNU long names for the following entry', async () => {
    const long = `${'x'.repeat(150)}.typ`;
    const files = await untarGz(tar([{ name: '././@LongLink', type: 'L', body: `${long}\0` }, { name: 'short', body: 'B' }]));
    expect([...files.keys()]).toEqual([long]);
  });

  it('rejects data that is not gzip', async () => {
    await expect(untarGz(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});
