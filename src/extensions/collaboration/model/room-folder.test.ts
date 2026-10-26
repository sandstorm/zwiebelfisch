// Tests for room-folder.ts.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Project, type ProjectFiles } from '../../../core/project/project';
import { ProjectPath } from '../../../core/paths/paths';
import { ASSETS_MAP, FILES_MAP, META_MAP } from '../room-protocol';
import { RoomFolder } from './room-folder';
import { SharedAssets } from './shared-assets';
import { SharedProject } from './shared-project';

const path = ProjectPath.of;
const FOLDER = path('/reports/q1');

/** A room's Y.Doc with these texts and base commit, as the server writes them. */
function room(texts: Record<string, string>, baseSha = 'a1') {
  const ydoc = new Y.Doc();
  ydoc.transact(() => {
    for (const [key, text] of Object.entries(texts)) ydoc.getMap<Y.Text>(FILES_MAP).set(key, new Y.Text(text));
    ydoc.getMap(META_MAP).set('baseSha', baseSha);
  });
  return ydoc;
}

/** A client joining `ydoc` as the widget does for a GitLab room (by default no files of its own: an empty main file). */
function join(ydoc: Y.Doc, options: { mainLocked?: boolean; main?: string; files?: ProjectFiles } = {}) {
  const project = new Project(path(options.main ?? '/main.typ'), options.files ?? {}, { mainLocked: options.mainLocked });
  const sent: unknown[] = [];
  const folder = new RoomFolder(FOLDER, project, ydoc, { send: (payload) => sent.push(JSON.parse(payload)) });
  new SharedAssets(project, ydoc, async () => new Uint8Array());
  new SharedProject(project, ydoc);
  return { project, folder, sent };
}

describe('RoomFolder', () => {
  it('tells the files from outside the folder that the branch has: those of the base', () => {
    const ydoc = room({ '/reports/q1/main.typ': '= Q1', '/template.typ': 'T', '/new.typ': '' });
    ydoc.getMap(META_MAP).set('base', { '/reports/q1/main.typ': '= Q1', '/template.typ': 'T' });
    ydoc.getMap(META_MAP).set('baseAssets', { '/logo.png': 'sha' });
    const { folder } = join(ydoc);
    expect(['/template.typ', '/logo.png', '/new.typ', '/reports/q1/main.typ'].map((file) => folder.onBranch(path(file)))).toEqual([true, true, false, false]);
  });

  it("makes the folder's main.typ the main file, and drops the empty one outside it", () => {
    const ydoc = room({ '/reports/q1/a.typ': 'A', '/reports/q1/main.typ': '= Q1' });
    const { project } = join(ydoc);
    expect(project.main).toBe('/reports/q1/main.typ');
    expect(project.document(path('/reports/q1/main.typ'))!.text).toBe('= Q1');
    expect(project.paths()).toEqual(['/reports/q1/main.typ', '/reports/q1/a.typ']);
    // nothing seeded outside the folder
    expect([...ydoc.getMap(FILES_MAP).keys()].sort()).toEqual(['/reports/q1/a.typ', '/reports/q1/main.typ']);
  });

  it("drops the host's files outside the folder that the room does not hold, so none is shared", () => {
    const ydoc = room({ '/reports/q1/main.typ': '= Q1', '/shared.typ': 'S' });
    const files = { '/main.typ': 'local', '/logo.png': new Uint8Array([1]), '/shared.typ': 'mine', '/reports/q1/extra.typ': 'E' };
    const { project } = join(ydoc, { files });
    expect(project.paths()).toEqual(['/reports/q1/main.typ', '/reports/q1/extra.typ', '/shared.typ']);
    expect(project.document(path('/shared.typ'))!.text).toBe('S');
    expect([...ydoc.getMap(FILES_MAP).keys()].sort()).toEqual(['/reports/q1/extra.typ', '/reports/q1/main.typ', '/shared.typ']);
    expect([...ydoc.getMap(ASSETS_MAP).keys()]).toEqual([]);
  });

  it('else its first .typ file, else a new main.typ in it', () => {
    expect(join(room({ '/reports/q1/b.typ': 'B', '/reports/q1/a.typ': 'A', '/template.typ': 'T' })).project.main).toBe('/reports/q1/a.typ');
    const ydoc = room({});
    expect(join(ydoc).project.main).toBe('/reports/q1/main.typ');
    expect([...ydoc.getMap(FILES_MAP).keys()]).toEqual(['/reports/q1/main.typ']);
  });

  it("leaves the main file alone when the host fixed it, or the room holds it", () => {
    expect(join(room({ '/reports/q1/main.typ': '' }), { mainLocked: true }).project.main).toBe('/main.typ');
    expect(join(room({ '/reports/q1/main.typ': '', '/reports/q1/a.typ': '' }), { main: '/reports/q1/a.typ' }).project.main).toBe('/reports/q1/a.typ');
  });

  it('asks for a file from outside the folder once per base commit, not for its own or one it has', () => {
    const ydoc = room({ '/reports/q1/main.typ': '', '/shared.typ': 'S' });
    const { folder, sent } = join(ydoc);
    folder.pull(path('/template.typ'));
    folder.pull(path('/template.typ'));
    folder.pull(path('/reports/q1/missing.typ'));
    folder.pull(path('/shared.typ'));
    expect(sent).toEqual([{ type: 'gitlab:pull', path: '/template.typ' }]);
    ydoc.getMap(META_MAP).set('baseSha', 'b2');
    folder.pull(path('/template.typ'));
    expect(sent).toHaveLength(2);
  });
});
