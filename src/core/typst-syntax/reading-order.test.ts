// Tests for typst-syntax.ts: neighbours (the reading order of the project's files).
import { describe, expect, it } from 'vitest';
import { neighbours } from './typst-syntax';
import { ProjectPath } from '../paths/paths';

const path = ProjectPath.of;

/** Reads from a file map, as the widget reads its project. */
const from = (files: Record<string, string>) => (path: string) => files[path];

const BOOK = {
  '/main.typ': '#set page(width: 12cm)\n= Book\n#include "chapters/introduction.typ"\n#include "chapters/method.typ"\n#include "/chapters/results.typ"\n',
  '/chapters/introduction.typ': '= Introduction\n',
  '/chapters/method.typ': '= Method\n#include "setup.typ"\n#image("plot.png")\n',
  '/chapters/setup.typ': '== Setup\n',
  '/chapters/results.typ': '= Results\n',
  '/template.typ': '#let accent = blue\n',
};

describe('neighbours', () => {
  it('gives the files before and after `path` in reading order', () => {
    expect(neighbours(from(BOOK), path('/main.typ'), path('/chapters/method.typ'))).toEqual({ previous: path('/chapters/introduction.typ'), next: path('/chapters/setup.typ') });
    expect(neighbours(from(BOOK), path('/main.typ'), path('/chapters/introduction.typ'))).toEqual({ previous: path('/main.typ'), next: path('/chapters/method.typ') });
    expect(neighbours(from(BOOK), path('/main.typ'), path('/chapters/results.typ'))).toEqual({ previous: path('/chapters/setup.typ'), next: null });
  });

  it('is null for the main file and files that are not included', () => {
    expect(neighbours(from(BOOK), path('/main.typ'), path('/main.typ'))).toBeNull();
    expect(neighbours(from(BOOK), path('/main.typ'), path('/template.typ'))).toBeNull();
  });

  it('follows nested includes in place, and leaves out imports, missing files, files included twice and include cycles', () => {
    const files = {
      '/main.typ': '#import "template.typ": accent\n#include "a.typ"\n#include "missing.typ"\n#include "a.typ"\n',
      '/a.typ': '#include "main.typ"\n#include "b.typ"\n',
      '/b.typ': '#include "a.typ"\n',
      '/template.typ': '',
    };
    const main = path('/main.typ');
    expect(neighbours(from(files), main, path('/a.typ'))).toEqual({ previous: main, next: path('/b.typ') });
    expect(neighbours(from(files), main, path('/b.typ'))).toEqual({ previous: path('/a.typ'), next: null });
    expect(neighbours(from(files), main, path('/missing.typ'))).toBeNull();
  });

  it('follows the includes of a file as its text changes (asked after every change: only the changed file is read again)', () => {
    const files: Record<string, string> = { '/main.typ': '#include "a.typ"\n', '/a.typ': 'A\n', '/b.typ': 'B\n' };
    const main = path('/main.typ');
    expect(neighbours(from(files), main, path('/b.typ'))).toBeNull();
    files['/main.typ'] = '#include "a.typ"\n#include "b.typ"\n';
    expect(neighbours(from(files), main, path('/b.typ'))).toEqual({ previous: path('/a.typ'), next: null });
    files['/main.typ'] = '#include "b.typ"\n';
    expect(neighbours(from(files), main, path('/b.typ'))).toEqual({ previous: main, next: null });
  });

  it('is null for every file without a main file', () => {
    expect(neighbours(from({ '/a.typ': 'A' }), path('/main.typ'), path('/a.typ'))).toBeNull();
  });
});
