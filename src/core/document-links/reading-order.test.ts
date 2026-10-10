// Tests for reading-order.ts.
import { describe, expect, it } from 'vitest';
import { neighbours, readingOrder } from './reading-order';

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
    expect(readingOrder(from(BOOK), '/main.typ')).toEqual([
      '/main.typ',
      '/chapters/introduction.typ',
      '/chapters/method.typ',
      '/chapters/setup.typ',
      '/chapters/results.typ',
    ]);
  });

  it('leaves out imports, missing files, files included twice and include cycles', () => {
    const files = {
      '/main.typ': '#import "template.typ": accent\n#include "a.typ"\n#include "missing.typ"\n#include "a.typ"\n',
      '/a.typ': '#include "main.typ"\n#include "b.typ"\n',
      '/b.typ': '#include "a.typ"\n',
      '/template.typ': '',
    };
    expect(readingOrder(from(files), '/main.typ')).toEqual(['/main.typ', '/a.typ', '/b.typ']);
  });

  it('is only the main file without includes, and empty without a main file', () => {
    expect(readingOrder(from({ '/main.typ': 'Hi' }), '/main.typ')).toEqual(['/main.typ']);
    expect(readingOrder(from({}), '/main.typ')).toEqual([]);
  });
});

describe('neighbours', () => {
  it('gives the files before and after `path` in reading order', () => {
    expect(neighbours(from(BOOK), '/main.typ', '/chapters/method.typ')).toEqual({ previous: '/chapters/introduction.typ', next: '/chapters/setup.typ' });
    expect(neighbours(from(BOOK), '/main.typ', '/chapters/introduction.typ')).toEqual({ previous: '/main.typ', next: '/chapters/method.typ' });
    expect(neighbours(from(BOOK), '/main.typ', '/chapters/results.typ')).toEqual({ previous: '/chapters/setup.typ', next: null });
  });

  it('is null for the main file and files that are not included', () => {
    expect(neighbours(from(BOOK), '/main.typ', '/main.typ')).toBeNull();
    expect(neighbours(from(BOOK), '/main.typ', '/template.typ')).toBeNull();
  });
});
