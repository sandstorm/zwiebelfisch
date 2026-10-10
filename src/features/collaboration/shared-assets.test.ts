// Tests for shared-assets.ts.
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Project } from '../../core/project/project';
import { ASSETS_MAP } from './gitlab-protocol';
import { connect } from './in-process';
import { SharedAssets } from './shared-assets';
import { ProjectPath } from '../../core/paths/paths';

const path = ProjectPath.of;

const MAIN = path('/main.typ');
const LOGO = new Uint8Array([1, 2, 3]);

function client(files: Record<string, string | Uint8Array> = {}, ydoc = new Y.Doc(), load = vi.fn(async (_path: string) => LOGO)) {
  const project = new Project(MAIN, files);
  return { project, ydoc, load, assets: ydoc.getMap<string | Uint8Array>(ASSETS_MAP), shared: new SharedAssets(project, ydoc, load) };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('SharedAssets', () => {
  it('loads the repository files of the room by path', async () => {
    const ydoc = new Y.Doc();
    ydoc.getMap(ASSETS_MAP).set(path('/img/logo.png'), 'sha-logo');
    const { project, load } = client({}, ydoc);
    await settle();
    expect(load).toHaveBeenCalledWith(path('/img/logo.png'));
    expect(project.content(path('/img/logo.png'))).toEqual(LOGO);
  });

  it('shares uploads, renames and deletes both ways', () => {
    const a = client();
    const b = client();
    connect(a.ydoc, b.ydoc);
    a.project.apply({ kind: 'create', path: path('/up.png'), content: new Uint8Array([7]) });
    expect(b.project.content(path('/up.png'))).toEqual(new Uint8Array([7]));
    b.project.apply({ kind: 'rename', from: path('/up.png'), path: path('/img/up.png') });
    expect(a.project.paths()).toEqual([MAIN, path('/img/up.png')]);
    a.project.apply({ kind: 'delete', path: path('/img/up.png') });
    expect(b.project.has(path('/img/up.png'))).toBe(false);
    expect(a.assets.size).toBe(0);
  });

  it('does not share Typst files, and seeds the local other files', () => {
    const { assets } = client({ '/a.typ': 'a', '/data.csv': 'x,y' });
    expect([...assets.keys()]).toEqual(['/data.csv']);
    expect(assets.get(path('/data.csv'))).toEqual(new TextEncoder().encode('x,y'));
  });

  it('does not load an upload again once the server committed it (bytes → sha)', async () => {
    const a = client();
    a.project.apply({ kind: 'create', path: path('/up.png'), content: new Uint8Array([7]) });
    a.ydoc.transact(() => a.assets.set(path('/up.png'), 'sha-up'), 'server');
    await settle();
    expect(a.load).not.toHaveBeenCalled();
    expect(a.project.content(path('/up.png'))).toEqual(new Uint8Array([7]));
  });

  it('replaces a file whose repository version changed upstream', async () => {
    const a = client();
    a.ydoc.transact(() => a.assets.set(path('/logo.png'), 'sha-1'), 'server');
    await settle();
    a.load.mockResolvedValueOnce(new Uint8Array([9]));
    a.ydoc.transact(() => a.assets.set(path('/logo.png'), 'sha-2'), 'server');
    await settle();
    expect(a.project.content(path('/logo.png'))).toEqual(new Uint8Array([9]));
  });
});
