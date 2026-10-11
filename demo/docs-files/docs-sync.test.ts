// @vitest-environment jsdom
// Tests for docs-sync.ts: per-file debounced writes, structural changes on disk first, no echo, the conflict rule
// (also against a write under way), the snapshot.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectPath, type FileChange, type ProjectFiles } from '../../src';
import { DocsSync, docsFilesToken, httpDocsFilesApi, type DocsFilesApi } from './docs-sync';
import { contentTag } from './protocol';

const path = (p: string) => ProjectPath.of(p);
const text = (content: Uint8Array) => new TextDecoder().decode(content);
const bytes = (content: string) => new TextEncoder().encode(content);

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

function setup(files: ProjectFiles = { '/main.typ': '= Docs\n', '/10_guide/02_features.typ': '= Features\n', '/assets/logo.svg': new Uint8Array([60]) }) {
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
    editor.edit('/10_guide/02_features.typ', '= F');
    await vi.advanceTimersByTimeAsync(200);
    editor.edit('/10_guide/02_features.typ', '= Fe');
    editor.edit('/main.typ', '= D');
    await vi.advanceTimersByTimeAsync(299);
    expect(api.write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.write.mock.calls.map(([p, bytes]) => [p, text(bytes)])).toEqual([
      ['10_guide/02_features.typ', '= Fe'],
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
    expect(api.write).toHaveBeenCalledWith('main.typ', bytes('= Leaving\n'), bytes('= Docs\n'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.write).toHaveBeenCalledTimes(1);
  });

  it('flush writes no file that is back to what is on disk', () => {
    const { api, sync, editor } = setup();
    editor.edit('/main.typ', '= Changed\n');
    editor.edit('/main.typ', '= Docs\n');
    sync.flush();
    expect(api.write).not.toHaveBeenCalled();
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
    expect(api.write).toHaveBeenCalledWith('assets/shot.png', png, null);
    expect(await sync.allowFileChange({ kind: 'rename', path: path('/10_guide/all.typ'), from: path('/10_guide/02_features.typ') })).toBe(true);
    expect(api.rename).toHaveBeenCalledWith('10_guide/02_features.typ', '10_guide/all.typ');
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
    editor.edit('/10_guide/02_features.typ', '= Edited\n');
    const rename: FileChange = { kind: 'rename', path: path('/10_guide/renamed.typ'), from: path('/10_guide/02_features.typ') };
    expect(await sync.allowFileChange(rename)).toBe(true);
    editor.rename(rename);
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.rename).toHaveBeenCalledBefore(api.write);
    expect(api.write.mock.calls.map(([p, bytes]) => [p, text(bytes)])).toEqual([['10_guide/renamed.typ', '= Edited\n']]);
  });
});

describe('changes on disk', () => {
  it('replace the file in the editor when it has no unsaved edits, and are not written back', async () => {
    const { api, sync, editor, lastReport } = setup();
    sync.external({ path: '10_guide/02_features.typ', text: '= From git\n' });
    expect(editor.files['/10_guide/02_features.typ']).toBe('= From git\n');
    expect(lastReport()).toBe('Updated docs/10_guide/02_features.typ from disk');
    sync.external({ path: 'assets/logo.svg', text: '<svg/>' });
    expect(text(editor.files['/assets/logo.svg'] as Uint8Array)).toBe('<svg/>');
    sync.external({ path: '10_guide/new.typ', text: '= New\n' });
    expect(editor.files['/10_guide/new.typ']).toBe('= New\n');
    sync.external({ path: '10_guide/new.typ', deleted: true });
    expect(editor.files['/10_guide/new.typ']).toBeUndefined();
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

  it('a snapshot brings in what differs from what the page started with (a build’s older files): changed, new, deleted', async () => {
    const { api, sync, editor, report } = setup();
    sync.snapshot([
      { path: 'main.typ', text: '= Docs\n' },
      { path: '10_guide/02_features.typ', text: '= Features, newer\n' },
      { path: '10_guide/03_new.typ', text: '= New\n' },
      { path: 'notes.md', text: '# Notes' },
    ]);
    expect(editor.files).toEqual({ '/main.typ': '= Docs\n', '/10_guide/02_features.typ': '= Features, newer\n', '/10_guide/03_new.typ': '= New\n' });
    expect(report).not.toHaveBeenCalledWith(expect.stringMatching(/main\.typ/), expect.anything());
    // the same snapshot again (a reconnect) changes nothing
    report.mockClear();
    sync.snapshot([{ path: 'main.typ', text: '= Docs\n' }, { path: '10_guide/02_features.typ', text: '= Features, newer\n' }, { path: '10_guide/03_new.typ', text: '= New\n' }]);
    expect(report).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.write).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });
});

describe('a change on disk while a write is decided or under way', () => {
  /** The plugin's side as far as a write goes: a disk, written only over the version the write names. */
  function server(files: Record<string, string>) {
    const disk = new Map(Object.entries(files));
    let release = () => {};
    const api = {
      write: vi.fn<DocsFilesApi['write']>(async (p, content, base) => {
        // the request takes a while: the change on disk may arrive meanwhile
        await new Promise<void>((resolve) => (release = resolve));
        const current = disk.get(p);
        if ((current === undefined ? null : current) !== (base && text(base))) throw new Error(`${p} changed on disk since this page read it`);
        disk.set(p, text(content));
      }),
      delete: vi.fn<DocsFilesApi['delete']>(async () => {}),
      rename: vi.fn<DocsFilesApi['rename']>(async () => {}),
    };
    /** Someone else (git) writes the file; the page hears of it. */
    const change = (sync: DocsSync, p: string, content: string) => {
      disk.set(p, content);
      sync.external({ path: p, text: content });
    };
    return { disk, api, change, release: () => release() };
  }

  function page(api: DocsFilesApi) {
    const report = vi.fn();
    const files = { '/main.typ': '= Docs\n' };
    const sync = new DocsSync(api, files, report);
    const editor = new FakeEditor(files, (change) => sync.filesChanged(change));
    sync.attach(editor);
    return { sync, editor, report };
  }

  it('a save decided before the change arrives does not undo it on disk: refused, said, and the editor keeps its text', async () => {
    const { disk, api, change, release } = server({ 'main.typ': '= Docs\n' });
    const { sync, editor, report } = page(api);
    editor.edit('/main.typ', '= Mine\n');
    await vi.advanceTimersByTimeAsync(300); // the write is on its way
    change(sync, 'main.typ', '= From git\n');
    release();
    await vi.runAllTimersAsync();
    expect(disk.get('main.typ')).toBe('= From git\n');
    expect(editor.files['/main.typ']).toBe('= Mine\n');
    expect(report).toHaveBeenCalledWith(expect.stringMatching(/^docs\/main\.typ changed on disk while it had unsaved edits here/), 'warn');
    expect(report).toHaveBeenLastCalledWith('Not saved: docs/main.typ (main.typ changed on disk since this page read it)', 'warn');
  });

  it('so does a flush when the page is hidden', async () => {
    const { disk, api, change, release } = server({ 'main.typ': '= Docs\n' });
    const { sync, editor } = page(api);
    editor.edit('/main.typ', '= Mine\n');
    sync.flush();
    change(sync, 'main.typ', '= From git\n');
    release();
    await vi.runAllTimersAsync();
    expect(disk.get('main.typ')).toBe('= From git\n');
  });

  it('a write that landed before the change does not hide it: the next edit (the user saw the note) saves over it', async () => {
    const { disk, api, change, release } = server({ 'main.typ': '= Docs\n' });
    const { sync, editor } = page(api);
    editor.edit('/main.typ', '= Mine\n');
    await vi.advanceTimersByTimeAsync(300);
    release(); // written, but the answer is not back yet
    await Promise.resolve();
    expect(disk.get('main.typ')).toBe('= Mine\n');
    change(sync, 'main.typ', '= From git\n');
    await vi.runAllTimersAsync();
    // the page knows the disk has "= From git": a snapshot on reconnect is no news, and the editor keeps its text
    sync.snapshot([{ path: 'main.typ', text: '= From git\n' }]);
    expect(editor.files['/main.typ']).toBe('= Mine\n');
    editor.edit('/main.typ', '= Mine, more\n');
    await vi.advanceTimersByTimeAsync(300);
    release();
    await vi.runAllTimersAsync();
    expect(api.write).toHaveBeenLastCalledWith('main.typ', bytes('= Mine, more\n'), bytes('= From git\n'));
    expect(disk.get('main.typ')).toBe('= Mine, more\n');
  });

  it('a file without unsaved edits takes the change and writes nothing, also when the page is hidden', async () => {
    const { disk, api, change } = server({ 'main.typ': '= Docs\n' });
    const { sync, editor } = page(api);
    change(sync, 'main.typ', '= From git\n');
    sync.flush();
    await vi.runAllTimersAsync();
    expect(editor.files['/main.typ']).toBe('= From git\n');
    expect(api.write).not.toHaveBeenCalled();
    expect(disk.get('main.typ')).toBe('= From git\n');
  });
});

describe('the HTTP API', () => {
  it('exists only with the plugin’s token in the page, and sends it with every request', async () => {
    document.head.replaceChildren();
    expect(docsFilesToken(document)).toBeNull();
    const meta = Object.assign(document.createElement('meta'), { name: 'docs-files-token', content: 'abc' });
    document.head.append(meta);
    expect(docsFilesToken(document)).toBe('abc');
    const send = vi.fn(async () => new Response(null, { status: 204 }));
    const api = httpDocsFilesApi('abc', send);
    await api.rename('a b.typ', 'c.typ');
    expect(send).toHaveBeenCalledWith('/__docs-files?path=a+b.typ&to=c.typ', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'x-docs-files-token': 'abc' }) }));
    send.mockResolvedValueOnce(new Response('Outside docs/', { status: 403 }));
    await expect(api.delete('x.typ')).rejects.toThrow('Outside docs/');
  });

  it('names the version a write replaces: If-Match with its tag, or If-None-Match: * for a new file', async () => {
    const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const api = httpDocsFilesApi('abc', send);
    await api.write('a.typ', bytes('= New\n'), bytes('= Old\n'));
    await api.write('b.typ', bytes('= New\n'), null);
    const headers = send.mock.calls.map(([, init]) => init!.headers as Record<string, string>);
    expect(headers[0]['if-match']).toBe(`"${contentTag(bytes('= Old\n'))}"`);
    expect(headers[1]['if-none-match']).toBe('*');
  });
});
