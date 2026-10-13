// Tests for shared-main-file.ts.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Project } from '../../../core/project/project';
import { ProjectPath } from '../../../core/paths/paths';
import { connect } from './in-process';
import { Collaboration } from './model';
import { SharedMainFile } from './shared-main-file';
import { SharedProject } from './shared-project';

const path = ProjectPath.of;

const MAIN = path('/main.typ');
const BOOK = path('/book.typ');

function client(files: Record<string, string> = { [MAIN]: '', [BOOK]: '' }, ydoc = new Y.Doc()) {
  const project = new Project(MAIN, files);
  new SharedProject(project, ydoc);
  return { project, ydoc, shared: new SharedMainFile(project, ydoc) };
}

describe('SharedMainFile', () => {
  it('a change of the main file reaches the other client, both ways', () => {
    const a = client();
    const b = client();
    connect(a.ydoc, b.ydoc);
    expect(a.project.setMain(BOOK)).toBeNull();
    expect(b.project.main).toBe(BOOK);
    b.project.setMain(MAIN);
    expect(a.project.main).toBe(MAIN);
  });

  it("a client joining takes the room's main file, once its file is there", () => {
    const a = client();
    a.project.setMain(BOOK);
    const ydoc = new Y.Doc();
    connect(a.ydoc, ydoc);
    expect(client({ [MAIN]: '' }, ydoc).project.main).toBe(BOOK);

    const chapter = path('/chapter.typ');
    const late = new Project(MAIN, { [MAIN]: '' });
    const lateDoc = new Y.Doc();
    lateDoc.getMap('project').set('main', chapter);
    new SharedMainFile(late, lateDoc);
    expect(late.main).toBe(MAIN);
    late.apply({ kind: 'create', path: chapter, content: '' });
    expect(late.main).toBe(chapter);
  });

  it('a room without a main file takes the local one; a value that is no path is ignored', () => {
    const a = client();
    expect(a.ydoc.getMap('project').get('main')).toBe(MAIN);
    a.ydoc.getMap('project').set('main', '../etc/passwd');
    expect(a.project.main).toBe(MAIN);
  });

  it('dispose() stops following the room', () => {
    const a = client();
    const b = client();
    connect(a.ydoc, b.ydoc);
    b.shared.dispose();
    a.project.setMain(BOOK);
    expect(b.project.main).toBe(MAIN);
  });

  it('a room leaves a host that locked the main file alone, both ways', async () => {
    const a = client();
    const ydoc = new Y.Doc();
    connect(a.ydoc, ydoc);
    a.project.setMain(BOOK);
    const locked = new Project(MAIN, { [MAIN]: '' }, { mainLocked: true });
    const collaboration = await Collaboration.start({ doc: ydoc }, { project: locked });
    expect(locked.has(BOOK)).toBe(true);
    expect(locked.main).toBe(MAIN);
    a.project.setMain(MAIN);
    a.project.setMain(BOOK);
    expect(locked.main).toBe(MAIN);
    expect(ydoc.getMap('project').get('main')).toBe(BOOK);
    collaboration.dispose();
  });
});
