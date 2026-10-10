// Tests for tree-model.ts.
import { describe, expect, it } from 'vitest';
import { ancestorsOf, buildTree, filesUnder, folderOf, navigate, relocate, visibleRows } from './tree-model';
import { ProjectPath } from '../../../core/paths/paths';

const path = ProjectPath.of;

const PATHS = [path('/main.typ'), path('/chapters/intro.typ'), path('/chapters/10-end.typ'), path('/chapters/2-middle.typ'), path('/img/logo.png'), path('/Zeta.typ'), path('/chapters/parts/a.typ')];

const names = (rows: { name: string; depth: number }[]) => rows.map((row) => `${'  '.repeat(row.depth)}${row.name}`);

describe('buildTree / visibleRows', () => {
  it('nests files in folders; folders first, then files, each sorted by name (numbers by value)', () => {
    const rows = visibleRows(buildTree(PATHS), new Set([path('/chapters'), path('/chapters/parts'), path('/img')]));
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
      [path('/chapters'), 'folder', false],
      [path('/img'), 'folder', false],
      [path('/main.typ'), 'file', undefined],
      [path('/Zeta.typ'), 'file', undefined],
    ]);
  });

  it('hides the content of a collapsed folder inside an expanded one', () => {
    const rows = visibleRows(buildTree(PATHS), new Set([path('/chapters')]));
    expect(names(rows).slice(0, 5)).toEqual(['chapters', '  parts', '  2-middle.typ', '  10-end.typ', '  intro.typ']);
  });

  it('keeps empty folders made in the panel', () => {
    const rows = visibleRows(buildTree([path('/main.typ')], [path('/drafts'), path('/drafts/old')]), new Set([path('/drafts')]));
    expect(names(rows)).toEqual(['drafts', '  old', 'main.typ']);
  });
});

describe('paths', () => {
  it('folderOf and ancestorsOf', () => {
    expect(folderOf(path('/a/b/c.typ'))).toBe(path('/a/b'));
    expect(folderOf(path('/c.typ'))).toBeNull();
    expect(ancestorsOf(path('/a/b/c.typ'))).toEqual([path('/a'), path('/a/b')]);
    expect(ancestorsOf(path('/c.typ'))).toEqual([]);
  });

  it('filesUnder lists the files in a folder at any depth', () => {
    expect(filesUnder(PATHS, path('/chapters'))).toEqual([path('/chapters/intro.typ'), path('/chapters/10-end.typ'), path('/chapters/2-middle.typ'), path('/chapters/parts/a.typ')]);
    expect(filesUnder(PATHS, path('/chap'))).toEqual([]);
  });
});

describe('relocate', () => {
  it('moves a file', () => {
    expect(relocate(PATHS, path('/main.typ'), path('/chapters/main.typ'))).toEqual([{ from: path('/main.typ'), path: path('/chapters/main.typ') }]);
  });

  it('moves a folder with everything in it', () => {
    expect(relocate(PATHS, path('/chapters/parts'), path('/parts'))).toEqual([{ from: path('/chapters/parts/a.typ'), path: path('/parts/a.typ') }]);
    expect(relocate(PATHS, path('/img'), path('/images'))).toEqual([{ from: path('/img/logo.png'), path: path('/images/logo.png') }]);
  });

  it('does nothing for the same place or a folder into itself', () => {
    expect(relocate(PATHS, path('/img'), path('/img'))).toEqual([]);
    expect(relocate(PATHS, path('/chapters'), path('/chapters/parts/chapters'))).toEqual([]);
  });
});

describe('navigate (keyboard)', () => {
  const tree = buildTree(PATHS);
  const rows = visibleRows(tree, new Set([path('/chapters')]));

  it('Up / Down / Home / End move the focus through the visible rows', () => {
    expect(navigate(rows, path('/chapters'), 'ArrowDown')).toEqual({ kind: 'focus', path: path('/chapters/parts') });
    expect(navigate(rows, path('/chapters/parts'), 'ArrowUp')).toEqual({ kind: 'focus', path: path('/chapters') });
    expect(navigate(rows, path('/chapters'), 'ArrowUp')).toBeNull();
    expect(navigate(rows, path('/chapters'), 'End')).toEqual({ kind: 'focus', path: path('/Zeta.typ') });
    expect(navigate(rows, path('/Zeta.typ'), 'Home')).toEqual({ kind: 'focus', path: path('/chapters') });
    expect(navigate(rows, null, 'ArrowDown')).toEqual({ kind: 'focus', path: path('/chapters') });
  });

  it('Right expands a folder, then goes to its first child; Left collapses, then goes to the parent', () => {
    expect(navigate(rows, path('/chapters/parts'), 'ArrowRight')).toEqual({ kind: 'expand', path: path('/chapters/parts') });
    expect(navigate(rows, path('/chapters'), 'ArrowRight')).toEqual({ kind: 'focus', path: path('/chapters/parts') });
    expect(navigate(rows, path('/chapters'), 'ArrowLeft')).toEqual({ kind: 'collapse', path: path('/chapters') });
    expect(navigate(rows, path('/chapters/intro.typ'), 'ArrowLeft')).toEqual({ kind: 'focus', path: path('/chapters') });
    expect(navigate(rows, path('/main.typ'), 'ArrowLeft')).toBeNull();
    expect(navigate(rows, path('/main.typ'), 'ArrowRight')).toBeNull();
  });

  it('Enter opens a file and toggles a folder', () => {
    expect(navigate(rows, path('/main.typ'), 'Enter')).toEqual({ kind: 'open', path: path('/main.typ') });
    expect(navigate(rows, path('/chapters'), 'Enter')).toEqual({ kind: 'collapse', path: path('/chapters') });
    expect(navigate(rows, path('/img'), 'Enter')).toEqual({ kind: 'expand', path: path('/img') });
  });

  it('ignores other keys', () => {
    expect(navigate(rows, path('/main.typ'), 'a')).toBeNull();
  });
});
