// Tests for typst-syntax.ts: findFilePaths.
import { describe, expect, it } from 'vitest';
import { findFilePaths } from './typst-syntax';

const SOURCE = `#import "template.typ": template
#include "chapters/intro.typ"
#image("img/logo.png", width: 50%)
#let data = json("data.json")
#bibliography("refs.bib")
#figure(image("x.png"), caption: [Hi])
#{ let y = read("a.txt"); csv("t.csv") + yaml("c.yaml") }
#import "@preview/cheq:0.4.0": checklist
#image(path: "q.png")
#text("not a path")
#let x = image.decode("<svg/>")
#image("")
`;

const text = (from: number, to: number) => SOURCE.slice(from, to);

describe('findFilePaths', () => {
  it('lists the file paths of imports, includes and file-reading calls, in order', () => {
    expect(findFilePaths(SOURCE).map((r) => [r.path, r.call])).toEqual([
      ['template.typ', 'import'],
      ['chapters/intro.typ', 'include'],
      ['img/logo.png', 'image'],
      ['data.json', 'json'],
      ['refs.bib', 'bibliography'],
      ['x.png', 'image'],
      ['a.txt', 'read'],
      ['t.csv', 'csv'],
      ['c.yaml', 'yaml'],
    ]);
  });

  it('gives the range of the path itself, without the quotes', () => {
    for (const found of findFilePaths(SOURCE)) expect(text(found.from, found.to)).toBe(found.path);
  });

  it('skips packages, named arguments, other calls, methods and empty strings', () => {
    const paths = findFilePaths(SOURCE).map((r) => r.path);
    expect(paths).not.toContain('@preview/cheq:0.4.0');
    expect(paths).not.toContain('q.png');
    expect(paths).not.toContain('not a path');
    expect(paths).not.toContain('<svg/>');
  });

  it('reads escapes in the string', () => {
    const [found] = findFilePaths('#include "a\\\\b.typ"');
    expect(found.path).toBe('a\\b.typ');
  });

  it('takes every path of a bibliography array', () => {
    expect(findFilePaths('#bibliography(("a.bib", "b.yml"))').map((r) => r.path)).toEqual(['a.bib', 'b.yml']);
  });

  it('looks at a part of the text only', () => {
    const found = findFilePaths(SOURCE, { from: SOURCE.indexOf('#include'), to: SOURCE.indexOf('#let') });
    expect(found.map((r) => r.path)).toEqual(['chapters/intro.typ', 'img/logo.png']);
  });
});
