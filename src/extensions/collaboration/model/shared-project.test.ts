// Tests for shared-project.ts.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Project } from '../../../core/project/project';
import { connect } from './in-process';
import { SharedProject } from './shared-project';
import { ProjectPath } from '../../../core/paths/paths';

const path = ProjectPath.of;

const MAIN = path('/main.typ');

function client(files: Record<string, string | Uint8Array> = {}, ydoc = new Y.Doc()) {
  const project = new Project(MAIN, files);
  return { project, ydoc, shared: new SharedProject(project, ydoc) };
}

const sharedPaths = (ydoc: Y.Doc) => [...ydoc.getMap('files').keys()].sort();

describe('SharedProject', () => {
  it('seeds an empty Y.Doc with the Typst files, not with other files', () => {
    const { ydoc } = client({ [MAIN]: 'main', '/a.typ': 'a', '/logo.png': new Uint8Array([1]) });
    expect(sharedPaths(ydoc)).toEqual(['/a.typ', MAIN]);
    expect(ydoc.getMap<Y.Text>('files').get(MAIN)!.toString()).toBe('main');
  });

  it('a client joining takes the shared text and the shared files', () => {
    const a = client({ [MAIN]: 'shared main', '/a.typ': 'a' });
    const ydoc = new Y.Doc();
    connect(a.ydoc, ydoc);
    const b = client({ [MAIN]: 'local main' }, ydoc);
    expect(b.project.document(MAIN)!.text).toBe('shared main');
    expect(b.project.document(path('/a.typ'))!.text).toBe('a');
  });

  it('edits of either client reach the other', () => {
    const a = client({ [MAIN]: 'Hello' });
    const b = client({}, new Y.Doc());
    connect(a.ydoc, b.ydoc);
    // b joined before syncing: it seeded its own (empty) main; one of the two texts wins on both.
    expect(b.project.document(MAIN)!.text).toBe(a.project.document(MAIN)!.text);
    a.project.document(MAIN)!.setText('Hello world', 'test');
    expect(b.project.document(MAIN)!.text).toBe('Hello world');
    b.project.document(MAIN)!.change([{ from: 0, to: 0, insert: '> ' }], 'test');
    expect(a.project.document(MAIN)!.text).toBe('> Hello world');
  });

  it('creating, renaming and deleting files reaches the other client', () => {
    const a = client({ [MAIN]: '' });
    const b = client({}, new Y.Doc());
    connect(a.ydoc, b.ydoc);
    a.project.apply({ kind: 'create', path: path('/ch1.typ'), content: 'Chapter' });
    expect(b.project.document(path('/ch1.typ'))!.text).toBe('Chapter');

    const changes: string[] = [];
    b.project.onDidChangeFile((change) => changes.push(change.kind));
    a.project.apply({ kind: 'rename', from: path('/ch1.typ'), path: path('/intro.typ') });
    expect(b.project.has(path('/ch1.typ'))).toBe(false);
    expect(b.project.document(path('/intro.typ'))!.text).toBe('Chapter');
    expect(changes).toEqual(['rename']);

    b.project.document(path('/intro.typ'))!.setText('Intro', 'test');
    expect(a.project.document(path('/intro.typ'))!.text).toBe('Intro');

    b.project.apply({ kind: 'delete', path: path('/intro.typ') });
    expect(a.project.has(path('/intro.typ'))).toBe(false);
    expect(sharedPaths(a.ydoc)).toEqual([MAIN]);
  });

  it('shares files replaced through the API', () => {
    const a = client({ [MAIN]: '', '/old.typ': 'old' });
    const b = client({}, new Y.Doc());
    connect(a.ydoc, b.ydoc);
    a.project.replace({ '/new.typ': 'new' });
    expect(b.project.has(path('/old.typ'))).toBe(false);
    expect(b.project.document(path('/new.typ'))!.text).toBe('new');
  });

  it('destroy() stops sharing and keeps the local text', () => {
    const a = client({ [MAIN]: 'abc' });
    a.shared.destroy();
    a.project.document(MAIN)!.setText('abcd', 'test');
    expect(a.ydoc.getMap<Y.Text>('files').get(MAIN)!.toString()).toBe('abc');
  });
});
