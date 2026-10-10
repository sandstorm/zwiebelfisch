// Tests for tree-model.ts.
import { describe, expect, it } from 'vitest';
import { ancestorsOf, buildTree, filesUnder, folderOf, navigate, relocate, visibleRows } from './tree-model';

const PATHS = ['/main.typ', '/chapters/intro.typ', '/chapters/10-end.typ', '/chapters/2-middle.typ', '/img/logo.png', '/Zeta.typ', '/chapters/parts/a.typ'];

const names = (rows: { name: string; depth: number }[]) => rows.map((row) => `${'  '.repeat(row.depth)}${row.name}`);

describe('buildTree / visibleRows', () => {
  it('nests files in folders; folders first, then files, each sorted by name (numbers by value)', () => {
    const rows = visibleRows(buildTree(PATHS), new Set(['/chapters', '/chapters/parts', '/img']));
    expect(names(rows)).toEqual([
      'chapters',
      '  parts',
      '    a.typ',
      '  2-middle.typ',
      '  10-end.typ',
      '  intro.typ',
      'img',
      '  logo.png',
      'main.typ',
      'Zeta.typ',
    ]);
  });

  it('shows only the top level while folders are collapsed', () => {
    const rows = visibleRows(buildTree(PATHS), new Set());
    expect(rows.map((row) => [row.path, row.kind, row.expanded])).toEqual([
      ['/chapters', 'folder', false],
      ['/img', 'folder', false],
      ['/main.typ', 'file', undefined],
      ['/Zeta.typ', 'file', undefined],
    ]);
  });

  it('hides the content of a collapsed folder inside an expanded one', () => {
    const rows = visibleRows(buildTree(PATHS), new Set(['/chapters']));
    expect(names(rows).slice(0, 5)).toEqual(['chapters', '  parts', '  2-middle.typ', '  10-end.typ', '  intro.typ']);
  });

  it('keeps empty folders made in the panel', () => {
    const rows = visibleRows(buildTree(['/main.typ'], ['/drafts', '/drafts/old']), new Set(['/drafts']));
    expect(names(rows)).toEqual(['drafts', '  old', 'main.typ']);
  });
});

describe('paths', () => {
  it('folderOf and ancestorsOf', () => {
    expect(folderOf('/a/b/c.typ')).toBe('/a/b');
    expect(folderOf('/c.typ')).toBe('');
    expect(ancestorsOf('/a/b/c.typ')).toEqual(['/a', '/a/b']);
    expect(ancestorsOf('/c.typ')).toEqual([]);
  });

  it('filesUnder lists the files in a folder at any depth', () => {
    expect(filesUnder(PATHS, '/chapters')).toEqual(['/chapters/intro.typ', '/chapters/10-end.typ', '/chapters/2-middle.typ', '/chapters/parts/a.typ']);
    expect(filesUnder(PATHS, '/chap')).toEqual([]);
  });
});

describe('relocate', () => {
  it('moves a file', () => {
    expect(relocate(PATHS, '/main.typ', '/chapters/main.typ')).toEqual([{ from: '/main.typ', path: '/chapters/main.typ' }]);
  });

  it('moves a folder with everything in it', () => {
    expect(relocate(PATHS, '/chapters/parts', '/parts')).toEqual([{ from: '/chapters/parts/a.typ', path: '/parts/a.typ' }]);
    expect(relocate(PATHS, '/img', '/images')).toEqual([{ from: '/img/logo.png', path: '/images/logo.png' }]);
  });

  it('does nothing for the same place or a folder into itself', () => {
    expect(relocate(PATHS, '/img', '/img')).toEqual([]);
    expect(relocate(PATHS, '/chapters', '/chapters/parts/chapters')).toEqual([]);
  });
});

describe('navigate (keyboard)', () => {
  const tree = buildTree(PATHS);
  const rows = visibleRows(tree, new Set(['/chapters']));

  it('Up / Down / Home / End move the focus through the visible rows', () => {
    expect(navigate(rows, '/chapters', 'ArrowDown')).toEqual({ focus: '/chapters/parts' });
    expect(navigate(rows, '/chapters/parts', 'ArrowUp')).toEqual({ focus: '/chapters' });
    expect(navigate(rows, '/chapters', 'ArrowUp')).toBeNull();
    expect(navigate(rows, '/chapters', 'End')).toEqual({ focus: '/Zeta.typ' });
    expect(navigate(rows, '/Zeta.typ', 'Home')).toEqual({ focus: '/chapters' });
    expect(navigate(rows, null, 'ArrowDown')).toEqual({ focus: '/chapters' });
  });

  it('Right expands a folder, then goes to its first child; Left collapses, then goes to the parent', () => {
    expect(navigate(rows, '/chapters/parts', 'ArrowRight')).toEqual({ expand: '/chapters/parts' });
    expect(navigate(rows, '/chapters', 'ArrowRight')).toEqual({ focus: '/chapters/parts' });
    expect(navigate(rows, '/chapters', 'ArrowLeft')).toEqual({ collapse: '/chapters' });
    expect(navigate(rows, '/chapters/intro.typ', 'ArrowLeft')).toEqual({ focus: '/chapters' });
    expect(navigate(rows, '/main.typ', 'ArrowLeft')).toBeNull();
    expect(navigate(rows, '/main.typ', 'ArrowRight')).toBeNull();
  });

  it('Enter opens a file and toggles a folder', () => {
    expect(navigate(rows, '/main.typ', 'Enter')).toEqual({ open: '/main.typ' });
    expect(navigate(rows, '/chapters', 'Enter')).toEqual({ collapse: '/chapters' });
    expect(navigate(rows, '/img', 'Enter')).toEqual({ expand: '/img' });
  });

  it('ignores other keys', () => {
    expect(navigate(rows, '/main.typ', 'a')).toBeNull();
  });
});
