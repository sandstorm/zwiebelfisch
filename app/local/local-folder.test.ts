import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectPath } from '../../src';
import { diskChange, missingFiles, Writes } from './local-folder';

const main = ProjectPath.of('/main.typ');
const chapter = ProjectPath.of('/chapter.typ');
const base64 = (text: string) => btoa(text);

describe('Writes', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function writes(fail = vi.fn()) {
    const sent: string[] = [];
    const w = new Writes(async (url, init) => {
      const body = init.body instanceof Uint8Array ? ` ${new TextDecoder().decode(init.body)}` : init.body ? ` ${String(init.body)}` : '';
      sent.push(`${init.method} ${url}${body}`);
      if (url.includes('refused')) return Promise.reject(new Error('is hidden'));
      return new Response(null, { status: 204 });
    }, fail);
    return { w, sent, fail };
  }

  it('writes the last text of a Typst file a moment after its last edit', async () => {
    const { w, sent } = writes();
    w.save({ kind: 'update', path: main, content: '= A' });
    w.save({ kind: 'update', path: main, content: '= AB' });
    expect(w.pending(main)).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(sent).toEqual(['PUT /api/local/files/main.typ = AB']);
    expect(w.pending()).toBe(false);
  });

  it('writes edits before a rename, and creations and deletions at once, in order', async () => {
    const { w, sent } = writes();
    w.save({ kind: 'update', path: chapter, content: 'Draft' });
    w.save({ kind: 'rename', from: chapter, path: ProjectPath.of('/parts/one two.typ') });
    w.save({ kind: 'create', path: ProjectPath.of('/logo.png'), content: new Uint8Array([104, 105]) });
    w.save({ kind: 'update', path: main, content: 'gone soon' });
    w.save({ kind: 'delete', path: main });
    await vi.runAllTimersAsync();
    expect(sent).toEqual([
      'PUT /api/local/files/chapter.typ Draft',
      'POST /api/local/rename {"from":"/chapter.typ","to":"/parts/one two.typ"}',
      'PUT /api/local/files/logo.png hi',
      'DELETE /api/local/files/main.typ',
    ]);
  });

  it('tells a failed write with the file, and goes on', async () => {
    const { w, sent, fail } = writes();
    w.save({ kind: 'create', path: ProjectPath.of('/refused.csv'), content: 'x' });
    w.save({ kind: 'create', path: ProjectPath.of('/data.csv'), content: 'y' });
    await vi.runAllTimersAsync();
    expect(fail).toHaveBeenCalledWith('refused.csv not saved: is hidden');
    expect(sent.at(-1)).toBe('PUT /api/local/files/data.csv y');
  });
});

describe('diskChange', () => {
  it('creates or updates, as text for Typst files and bytes for others', () => {
    expect(diskChange({ kind: 'update', path: '/chapter.typ', content: base64('Hi') }, chapter, false, main)).toEqual({ kind: 'create', path: chapter, content: 'Hi' });
    expect(diskChange({ kind: 'create', path: '/main.typ', content: base64('Hi') }, main, true, main)).toEqual({ kind: 'update', path: main, content: 'Hi' });
    const logo = ProjectPath.of('/logo.png');
    expect(diskChange({ kind: 'update', path: '/logo.png', content: base64('hi') }, logo, true, main)).toEqual({ kind: 'update', path: logo, content: new Uint8Array([104, 105]) });
  });

  it('keeps the main file, and renames only onto a free path', () => {
    expect(diskChange({ kind: 'delete', path: '/main.typ' }, main, true, main)).toBeNull();
    expect(diskChange({ kind: 'delete', path: '/chapter.typ' }, chapter, true, main)).toEqual({ kind: 'delete', path: chapter });
    expect(diskChange({ kind: 'delete', path: '/chapter.typ' }, chapter, false, main)).toBeNull();
    const to = ProjectPath.of('/two.typ');
    expect(diskChange({ kind: 'rename', path: '/two.typ', from: '/chapter.typ' }, to, false, main)).toEqual({ kind: 'rename', from: chapter, path: to });
    expect(diskChange({ kind: 'rename', path: '/two.typ', from: '/chapter.typ' }, to, true, main)).toBeNull();
  });
});

describe('missingFiles', () => {
  it('reads the paths of the files a compile did not find', () => {
    expect(
      missingFiles([
        { message: 'file not found (searched at server/main.go)' },
        { message: 'unknown variable: x' },
        { message: 'file not found (searched at ../outside.typ)' },
      ]),
    ).toEqual(['/server/main.go']);
  });
});
