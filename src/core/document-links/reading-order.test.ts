// Tests for reading-order.ts.
import { describe, expect, it } from 'vitest';
import { neighbours, readingOrder } from './reading-order';
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

describe('readingOrder', () => {
  it('lists the main file, then every included file in the order Typst reads them (nested includes in place)', () => {
    expect(readingOrder(from(BOOK), path('/main.typ'))).toEqual([
      path('/main.typ'),
      path('/chapters/introduction.typ'),
      path('/chapters/method.typ'),
      path('/chapters/setup.typ'),
      path('/chapters/results.typ'),
    ]);
  });

  it('leaves out imports, missing files, files included twice and include cycles', () => {
    const files = {
      '/main.typ': '#import "template.typ": accent\n#include "a.typ"\n#include "missing.typ"\n#include "a.typ"\n',
      '/a.typ': '#include "main.typ"\n#include "b.typ"\n',
      '/b.typ': '#include "a.typ"\n',
      '/template.typ': '',
    };
    expect(readingOrder(from(files), path('/main.typ'))).toEqual([path('/main.typ'), path('/a.typ'), path('/b.typ')]);
  });

  it('is only the main file without includes, and empty without a main file', () => {
    expect(readingOrder(from({ '/main.typ': 'Hi' }), path('/main.typ'))).toEqual([path('/main.typ')]);
    expect(readingOrder(from({}), path('/main.typ'))).toEqual([]);
  });
});

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
});
