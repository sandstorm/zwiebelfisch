import { describe, expect, it, vi } from 'vitest';
import { Project } from './project';

const logo = new Uint8Array([1, 2, 3]);

function project() {
  return new Project('/main.typ', {
    '/main.typ': '= Main',
    '/zeta.typ': 'Z',
    '/chapter.typ': 'C',
    '/logo.png': logo,
    '/data.csv': 'a,b',
  });
}

describe('Project', () => {
  it('lists the main file first, then other Typst files, then the rest', () => {
    expect(project().paths()).toEqual(['/main.typ', '/chapter.typ', '/zeta.typ', '/data.csv', '/logo.png']);
  });

  it('gives every .typ file its own document and keeps other files as they are', () => {
    const p = project();
    expect(p.document('/chapter.typ')?.text).toBe('C');
    expect(p.document('/main.typ')).not.toBe(p.document('/chapter.typ'));
    expect(p.document('/data.csv')).toBeUndefined();
    expect(p.content('/logo.png')).toBe(logo);
    expect(p.pathOf(p.document('/zeta.typ')!)).toBe('/zeta.typ');
  });

  it('reports the current text of every file', () => {
    const p = project();
    p.document('/chapter.typ')!.setText('C2', 'test');
    expect(p.files()['/chapter.typ']).toBe('C2');
    expect(p.files()['/logo.png']).toBe(logo);
  });

  it('creates the main file when it is missing', () => {
    const p = new Project('/main.typ', {});
    expect(p.paths()).toEqual(['/main.typ']);
    expect(p.document('/main.typ')?.text).toBe('');
  });

  it('creates, renames and deletes files and notifies listeners', () => {
    const p = project();
    const listener = vi.fn();
    p.onChange(listener);
    p.apply({ kind: 'create', path: '/new.typ', content: '' });
    p.apply({ kind: 'rename', from: '/new.typ', path: '/parts/new.typ' });
    p.apply({ kind: 'delete', path: '/zeta.typ' });
    expect(p.paths()).toEqual(['/main.typ', '/chapter.typ', '/parts/new.typ', '/data.csv', '/logo.png']);
    expect(listener.mock.calls.map(([change]) => change.kind)).toEqual(['create', 'rename', 'delete']);
  });

  it('keeps the same document when a file is renamed', () => {
    const p = project();
    const doc = p.document('/chapter.typ');
    p.apply({ kind: 'rename', from: '/chapter.typ', path: '/intro.typ' });
    expect(p.document('/intro.typ')).toBe(doc);
    expect(p.pathOf(doc!)).toBe('/intro.typ');
  });

  it('reports text edits of any Typst file as updates', () => {
    const p = project();
    const listener = vi.fn();
    p.onChange(listener);
    p.document('/chapter.typ')!.setText('C!', 'view');
    expect(listener).toHaveBeenCalledWith({ kind: 'update', path: '/chapter.typ', content: 'C!' });
  });

  it('stops reporting edits of deleted documents', () => {
    const p = project();
    const doc = p.document('/chapter.typ')!;
    p.apply({ kind: 'delete', path: '/chapter.typ' });
    const listener = vi.fn();
    p.onChange(listener);
    doc.setText('gone', 'view');
    expect(listener).not.toHaveBeenCalled();
  });

  it('protects the main file and refuses invalid changes', () => {
    const p = project();
    expect(p.check({ kind: 'delete', path: '/main.typ' })).toMatch(/main file/);
    expect(p.check({ kind: 'rename', from: '/main.typ', path: '/other.typ' })).toMatch(/main file/);
    expect(p.check({ kind: 'create', path: '/chapter.typ', content: '' })).toMatch(/already exists/);
    expect(p.check({ kind: 'rename', from: '/chapter.typ', path: '/zeta.typ' })).toMatch(/already exists/);
    expect(p.check({ kind: 'rename', from: '/chapter.typ', path: '/chapter.txt' })).toMatch(/\.typ/);
    expect(p.check({ kind: 'rename', from: '/logo.png', path: '/logo.typ' })).toMatch(/\.typ/);
    expect(p.check({ kind: 'delete', path: '/missing.typ' })).toMatch(/no file/);
    expect(p.check({ kind: 'create', path: '/a.typ', content: logo })).toMatch(/text/);
    expect(() => p.apply({ kind: 'delete', path: '/main.typ' })).toThrow(/main file/);
    expect(p.check({ kind: 'delete', path: '/zeta.typ' })).toBeNull();
  });

  it('applies updates to text files through their document', () => {
    const p = project();
    p.apply({ kind: 'update', path: '/chapter.typ', content: 'new' });
    expect(p.document('/chapter.typ')!.text).toBe('new');
    expect(p.check({ kind: 'update', path: '/logo.png', content: 'x' })).toMatch(/text/);
  });

  it('replaces the other files, keeping documents of paths that stay', () => {
    const p = project();
    const chapter = p.document('/chapter.typ');
    const main = p.document('/main.typ');
    p.replace({ '/chapter.typ': 'C new', '/extra.typ': 'E', '/main.typ': 'ignored' });
    expect(p.paths()).toEqual(['/main.typ', '/chapter.typ', '/extra.typ']);
    expect(p.document('/chapter.typ')).toBe(chapter);
    expect(chapter!.text).toBe('C new');
    expect(p.document('/main.typ')).toBe(main);
    expect(main!.text).toBe('= Main');
  });

  it('lists the other files without the main file', () => {
    expect(Object.keys(project().otherFiles())).toEqual(['/chapter.typ', '/zeta.typ', '/data.csv', '/logo.png']);
  });
});
