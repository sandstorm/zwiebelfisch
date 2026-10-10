// Tests for project.ts.
import { describe, expect, it, vi } from 'vitest';
import { Project } from './project';
import { ProjectPath } from '../paths/paths';

const path = ProjectPath.of;

const logo = new Uint8Array([1, 2, 3]);

function project() {
  return new Project(path('/main.typ'), {
    '/main.typ': '= Main',
    '/zeta.typ': 'Z',
    '/chapter.typ': 'C',
    '/logo.png': logo,
    '/data.csv': 'a,b',
  });
}

describe('Project', () => {
  it('lists the main file first, then other Typst files, then the rest', () => {
    expect(project().paths()).toEqual(['/main.typ', path('/chapter.typ'), path('/zeta.typ'), path('/data.csv'), path('/logo.png')]);
  });

  it('gives every .typ file its own document and keeps other files as they are', () => {
    const p = project();
    expect(p.document(path('/chapter.typ'))?.text).toBe('C');
    expect(p.document(path('/main.typ'))).not.toBe(p.document(path('/chapter.typ')));
    expect(p.document(path('/data.csv'))).toBeUndefined();
    expect(p.content(path('/logo.png'))).toBe(logo);
    expect(p.pathOf(p.document(path('/zeta.typ'))!)).toBe(path('/zeta.typ'));
  });

  it('reports the current text of every file', () => {
    const p = project();
    p.document(path('/chapter.typ'))!.setText('C2', 'test');
    expect(p.files()['/chapter.typ']).toBe('C2');
    expect(p.files()['/logo.png']).toBe(logo);
  });

  it('refuses bytes for the main file, as replace does', () => {
    expect(() => new Project(path('/main.typ'), { '/main.typ': new Uint8Array([1]) })).toThrow(/must contain text/);
  });

  it('creates the main file when it is missing', () => {
    const p = new Project(path('/main.typ'), {});
    expect(p.paths()).toEqual(['/main.typ']);
    expect(p.document(path('/main.typ'))?.text).toBe('');
  });

  it('creates, renames and deletes files and notifies listeners', () => {
    const p = project();
    const listener = vi.fn();
    p.onDidChangeFile(listener);
    p.apply({ kind: 'create', path: path('/new.typ'), content: '' });
    p.apply({ kind: 'rename', from: path('/new.typ'), path: path('/parts/new.typ') });
    p.apply({ kind: 'delete', path: path('/zeta.typ') });
    expect(p.paths()).toEqual(['/main.typ', path('/chapter.typ'), path('/parts/new.typ'), path('/data.csv'), path('/logo.png')]);
    expect(listener.mock.calls.map(([change]) => change.kind)).toEqual(['create', 'rename', 'delete']);
  });

  it('keeps the same document when a file is renamed', () => {
    const p = project();
    const doc = p.document(path('/chapter.typ'));
    p.apply({ kind: 'rename', from: path('/chapter.typ'), path: path('/intro.typ') });
    expect(p.document(path('/intro.typ'))).toBe(doc);
    expect(p.pathOf(doc!)).toBe(path('/intro.typ'));
  });

  it('reports text edits of any Typst file as updates', () => {
    const p = project();
    const listener = vi.fn();
    p.onDidChangeFile(listener);
    p.document(path('/chapter.typ'))!.setText('C!', 'view');
    expect(listener).toHaveBeenCalledWith({ kind: 'update', path: path('/chapter.typ'), content: 'C!' });
  });

  it('stops reporting edits of deleted documents', () => {
    const p = project();
    const doc = p.document(path('/chapter.typ'))!;
    p.apply({ kind: 'delete', path: path('/chapter.typ') });
    const listener = vi.fn();
    p.onDidChangeFile(listener);
    doc.setText('gone', 'view');
    expect(listener).not.toHaveBeenCalled();
  });

  it('protects the main file and refuses invalid changes', () => {
    const p = project();
    expect(p.check({ kind: 'delete', path: path('/main.typ') })).toMatch(/main file/);
    expect(p.check({ kind: 'rename', from: path('/main.typ'), path: path('/other.typ') })).toMatch(/main file/);
    expect(p.check({ kind: 'create', path: path('/chapter.typ'), content: '' })).toMatch(/already exists/);
    expect(p.check({ kind: 'rename', from: path('/chapter.typ'), path: path('/zeta.typ') })).toMatch(/already exists/);
    expect(p.check({ kind: 'rename', from: path('/chapter.typ'), path: path('/chapter.txt') })).toMatch(/\.typ/);
    expect(p.check({ kind: 'rename', from: path('/logo.png'), path: path('/logo.typ') })).toMatch(/\.typ/);
    expect(p.check({ kind: 'delete', path: path('/missing.typ') })).toMatch(/no file/);
    expect(p.check({ kind: 'create', path: path('/a.typ'), content: logo })).toMatch(/text/);
    expect(() => p.apply({ kind: 'delete', path: path('/main.typ') })).toThrow(/main file/);
    expect(p.check({ kind: 'delete', path: path('/zeta.typ') })).toBeNull();
  });

  it('applies updates to text files through their document', () => {
    const p = project();
    p.apply({ kind: 'update', path: path('/chapter.typ'), content: 'new' });
    expect(p.document(path('/chapter.typ'))!.text).toBe('new');
    expect(p.check({ kind: 'update', path: path('/chapter.typ'), content: new Uint8Array([1]) })).toMatch(/text/);
  });

  it('replaces the content of other files with an update, and tells listeners', () => {
    const p = project();
    const listener = vi.fn();
    p.onDidChangeFile(listener);
    const bytes = new Uint8Array([9, 9]);
    p.apply({ kind: 'update', path: path('/logo.png'), content: bytes });
    expect(p.content(path('/logo.png'))).toBe(bytes);
    expect(listener).toHaveBeenCalledWith({ kind: 'update', path: path('/logo.png'), content: bytes });
  });

  it('replaces the files, the main one included, keeping documents of paths that stay', () => {
    const p = project();
    const chapter = p.document(path('/chapter.typ'));
    const main = p.document(path('/main.typ'));
    p.replace({ '/chapter.typ': 'C new', '/extra.typ': 'E', '/main.typ': '= New main' });
    expect(p.paths()).toEqual(['/main.typ', path('/chapter.typ'), path('/extra.typ')]);
    expect(p.document(path('/chapter.typ'))).toBe(chapter);
    expect(chapter!.text).toBe('C new');
    expect(p.document(path('/main.typ'))).toBe(main);
    expect(main!.text).toBe('= New main');
  });

  it('keeps the main file when the replacing files have no entry for it, and refuses bytes for it', () => {
    const p = project();
    p.replace({ '/extra.typ': 'E' });
    expect(p.paths()).toEqual(['/main.typ', path('/extra.typ')]);
    expect(p.document(path('/main.typ'))!.text).toBe('= Main');
    expect(() => p.replace({ '/main.typ': new Uint8Array([1]) })).toThrow(/must contain text/);
    expect(p.paths()).toEqual(['/main.typ', path('/extra.typ')]);
  });

  it('tells listeners what replacing changed: deleted, created, updated files', () => {
    const p = project();
    const logo = p.content(path('/logo.png'));
    const listener = vi.fn();
    p.onDidChangeFile(listener);
    const csv = new Uint8Array([7]);
    p.replace({ '/chapter.typ': 'C new', '/extra.typ': 'E', '/logo.png': logo!, '/data.csv': csv });
    expect(listener.mock.calls.map(([change]) => change)).toEqual([
      { kind: 'delete', path: path('/zeta.typ') },
      { kind: 'update', path: path('/chapter.typ'), content: 'C new' },
      { kind: 'create', path: path('/extra.typ'), content: 'E' },
      { kind: 'update', path: path('/data.csv'), content: csv },
    ]);
  });
});
