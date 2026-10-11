// @vitest-environment jsdom
// Tests for docs-sync.ts: per-file debounced writes, structural changes on disk first, no echo, the conflict rule.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectPath, type FileChange, type ProjectFiles } from '../../src';
import { DocsSync, httpDocsFilesApi, type DocsFilesApi } from './docs-sync';

const path = (p: string) => ProjectPath.of(p);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** A stand-in for the widget: `files` as a plain map that reports assignments as the widget does. */
class FakeEditor {
  #files: ProjectFiles;
  constructor(
    files: ProjectFiles,
    private readonly onChange: (change: FileChange) => void,
  ) {
    this.#files = { ...files };
  }
  get files(): ProjectFiles {
    return { ...this.#files };
  }
  set files(next: ProjectFiles) {
    const before = this.#files;
    this.#files = { ...next };
    for (const [p, content] of Object.entries(next)) {
      if (before[p] !== content) this.onChange({ kind: p in before ? 'update' : 'create', path: path(p), content });
    }
    for (const p of Object.keys(before)) if (!(p in next)) this.onChange({ kind: 'delete', path: path(p) });
  }
  /** The widget's rename: the content moves, reported as one `rename`. */
  rename(change: FileChange & { kind: 'rename' }): void {
    this.#files[change.path] = this.#files[change.from];
    delete this.#files[change.from];
    this.onChange(change);
  }
  /** The user types: the file's new text, reported as the widget reports an edit. */
  edit(p: string, content: string): void {
    this.#files[p] = content;
    this.onChange({ kind: 'update', path: path(p), content });
  }
}

function setup(files: ProjectFiles = { '/main.typ': '= Docs\n', '/guide/features.typ': '= Features\n', '/assets/logo.svg': new Uint8Array([60]) }) {
  const api = {
    write: vi.fn<DocsFilesApi['write']>(async () => {}),
    delete: vi.fn<DocsFilesApi['delete']>(async () => {}),
    rename: vi.fn<DocsFilesApi['rename']>(async () => {}),
  };
  const report = vi.fn();
  const sync = new DocsSync(api, files, report);
  const editor = new FakeEditor(files, (change) => sync.filesChanged(change));
  sync.attach(editor);
  const lastReport = () => report.mock.lastCall?.[0] as string;
  return { api, report, sync, editor, lastReport };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('saving edits', () => {
  it('writes a file once its edits pause (300 ms), each file on its own, and reports it', async () => {
    const { api, editor, lastReport } = setup();
    editor.edit('/guide/features.typ', '= F');
    await vi.advanceTimersByTimeAsync(200);
    editor.edit('/guide/features.typ', '= Fe');
    editor.edit('/main.typ', '= D');
    await vi.advanceTimersByTimeAsync(299);
    expect(api.write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.write.mock.calls.map(([p, bytes]) => [p, text(bytes)])).toEqual([
      ['guide/features.typ', '= Fe'],
      ['main.typ', '= D'],
    ]);
    expect(lastReport()).toBe('Saved to docs/main.typ');
  });

  it('writes nothing when the text is back to what is on disk', async () => {
    const { api, editor } = setup();
    editor.edit('/main.typ', '= Changed\n');
    editor.edit('/main.typ', '= Docs\n');
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.write).not.toHaveBeenCalled();
  });

  it('flush writes what waits at once (the page is hidden)', async () => {
    const { api, sync, editor } = setup();
    editor.edit('/main.typ', '= Leaving\n');
    sync.flush();
    expect(api.write).toHaveBeenCalledWith('main.typ', new TextEncoder().encode('= Leaving\n'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.write).toHaveBeenCalledTimes(1);
  });

  it('reports a failed write', async () => {
    const { api, editor, lastReport } = setup();
    api.write.mockRejectedValueOnce(new Error('disk full'));
    editor.edit('/main.typ', '= X\n');
    await vi.advanceTimersByTimeAsync(300);
    expect(lastReport()).toBe('Not saved: docs/main.typ (disk full)');
  });
});

describe('create, rename, delete in the file panel', () => {
  it('happen on disk first; the editor may do them only if the disk did', async () => {
    const { api, sync, report } = setup();
    const png = new Uint8Array([137, 80]);
    expect(await sync.allowFileChange({ kind: 'create', path: path('/assets/shot.png'), content: png })).toBe(true);
    expect(api.write).toHaveBeenCalledWith('assets/shot.png', png);
    expect(await sync.allowFileChange({ kind: 'rename', path: path('/guide/all.typ'), from: path('/guide/features.typ') })).toBe(true);
    expect(api.rename).toHaveBeenCalledWith('guide/features.typ', 'guide/all.typ');
    api.delete.mockRejectedValueOnce(new Error('Outside docs/'));
    expect(await sync.allowFileChange({ kind: 'delete', path: path('/main.typ') })).toBe(false);
    expect(report).toHaveBeenLastCalledWith('Not saved: docs/main.typ (Outside docs/)', 'warn');
    expect(await sync.allowFileChange({ kind: 'update', path: path('/main.typ'), content: 'x' })).toBe(true);
  });

  it('the change the editor then reports is not done twice', async () => {
    const { api, sync } = setup();
    const create: FileChange = { kind: 'create', path: path('/new.typ'), content: '' };
    await sync.allowFileChange(create);
    sync.filesChanged(create);
    const remove: FileChange = { kind: 'delete', path: path('/main.typ') };
    await sync.allowFileChange(remove);
    sync.filesChanged(remove);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.write).toHaveBeenCalledTimes(1);
    expect(api.delete).toHaveBeenCalledTimes(1);
  });

  it('an edit still waiting when its file is renamed is written to the new path, after the rename', async () => {
    const { api, sync, editor } = setup();
    editor.edit('/guide/features.typ', '= Edited\n');
    const rename: FileChange = { kind: 'rename', path: path('/guide/renamed.typ'), from: path('/guide/features.typ') };
    expect(await sync.allowFileChange(rename)).toBe(true);
    editor.rename(rename);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.rename).toHaveBeenCalledBefore(api.write);
    expect(api.write.mock.calls.map(([p, bytes]) => [p, text(bytes)])).toEqual([['guide/renamed.typ', '= Edited\n']]);
  });
});

describe('changes on disk', () => {
  it('replace the file in the editor when it has no unsaved edits, and are not written back', async () => {
    const { api, sync, editor, lastReport } = setup();
    sync.external({ path: 'guide/features.typ', text: '= From git\n' });
    expect(editor.files['/guide/features.typ']).toBe('= From git\n');
    expect(lastReport()).toBe('Updated docs/guide/features.typ from disk');
    sync.external({ path: 'assets/logo.svg', text: '<svg/>' });
    expect(text(editor.files['/assets/logo.svg'] as Uint8Array)).toBe('<svg/>');
    sync.external({ path: 'guide/new.typ', text: '= New\n' });
    expect(editor.files['/guide/new.typ']).toBe('= New\n');
    sync.external({ path: 'guide/new.typ', deleted: true });
    expect(editor.files['/guide/new.typ']).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.write).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('keep the editor’s text when it has unsaved edits of that file, and say so', async () => {
    const { api, sync, editor, report } = setup();
    editor.edit('/main.typ', '= Mine\n');
    sync.external({ path: 'main.typ', text: '= Theirs\n' });
    expect(editor.files['/main.typ']).toBe('= Mine\n');
    expect(report).toHaveBeenLastCalledWith(expect.stringMatching(/^docs\/main\.typ changed on disk while it had unsaved edits here/), 'warn');
    // the waiting write is dropped: the next edit saves over the disk's version
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.write).not.toHaveBeenCalled();
    editor.edit('/main.typ', '= Mine!\n');
    await vi.advanceTimersByTimeAsync(300);
    expect(api.write).toHaveBeenCalledTimes(1);
  });

  it('a change equal to the editor’s text (its own write coming back) changes nothing', async () => {
    const { sync, editor, report } = setup();
    editor.edit('/main.typ', '= Saved\n');
    await vi.advanceTimersByTimeAsync(300);
    report.mockClear();
    editor.edit('/main.typ', '= Saved and more\n');
    sync.external({ path: 'main.typ', text: '= Saved\n' });
    expect(editor.files['/main.typ']).toBe('= Saved and more\n');
    expect(report).not.toHaveBeenCalledWith(expect.stringMatching(/changed on disk/), 'warn');
  });

  it('leave out a new file of a kind the example does not have', () => {
    const { sync, editor } = setup();
    sync.external({ path: 'notes.md', text: '# Notes' });
    expect(editor.files['/notes.md']).toBeUndefined();
  });
});

describe('the HTTP API', () => {
  it('exists only with the dev server’s token in the page, and sends it with every request', async () => {
    document.head.replaceChildren();
    expect(httpDocsFilesApi(document)).toBeNull();
    const meta = Object.assign(document.createElement('meta'), { name: 'docs-files-token', content: 'abc' });
    document.head.append(meta);
    const send = vi.fn(async () => new Response(null, { status: 204 }));
    const api = httpDocsFilesApi(document, send)!;
    await api.rename('a b.typ', 'c.typ');
    expect(send).toHaveBeenCalledWith('/__docs-files?path=a+b.typ&to=c.typ', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'x-docs-files-token': 'abc' }) }));
    send.mockResolvedValueOnce(new Response('Outside docs/', { status: 403 }));
    await expect(api.delete('x.typ')).rejects.toThrow('Outside docs/');
  });
});
