// Tests for room-folder.ts.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Project } from '../../../core/project/project';
import { ProjectPath } from '../../../core/paths/paths';
import { FILES_MAP, META_MAP } from '../room-protocol';
import { RoomFolder } from './room-folder';
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

/** A client joining `ydoc` as the widget does for a GitLab room (no files of its own: an empty main file). */
function join(ydoc: Y.Doc, options: { mainLocked?: boolean; main?: string } = {}) {
  const project = new Project(path(options.main ?? '/main.typ'), {}, { mainLocked: options.mainLocked });
  const sent: unknown[] = [];
  const folder = new RoomFolder(FOLDER, project, ydoc, { send: (payload) => sent.push(JSON.parse(payload)) });
  new SharedProject(project, ydoc);
  return { project, folder, sent };
}

describe('RoomFolder', () => {
  it("makes the folder's main.typ the main file, and drops the empty one outside it", () => {
    const ydoc = room({ '/reports/q1/a.typ': 'A', '/reports/q1/main.typ': '= Q1' });
    const { project } = join(ydoc);
    expect(project.main).toBe('/reports/q1/main.typ');
    expect(project.document(path('/reports/q1/main.typ'))!.text).toBe('= Q1');
    expect(project.paths()).toEqual(['/reports/q1/main.typ', '/reports/q1/a.typ']);
    // nothing seeded outside the folder
    expect([...ydoc.getMap(FILES_MAP).keys()].sort()).toEqual(['/reports/q1/a.typ', '/reports/q1/main.typ']);
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
