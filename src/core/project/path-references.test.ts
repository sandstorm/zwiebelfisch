// Tests for path-references.ts.
import { describe, expect, it } from 'vitest';
import { typstParser } from 'codemirror-lang-typst/lezer';
import { describeLink, findPathReferences, type FileLinks, pathReferenceAt } from './path-references';

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

describe('findPathReferences', () => {
  it('lists the file paths of imports, includes and file-reading calls, in order', () => {
    const found = findPathReferences(SOURCE);
    expect(found.map((r) => [r.path, r.call])).toEqual([
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
    for (const reference of findPathReferences(SOURCE)) expect(text(reference.from, reference.to)).toBe(reference.path);
  });

  it('skips packages, named arguments, other calls, methods and empty strings', () => {
    const paths = findPathReferences(SOURCE).map((r) => r.path);
    expect(paths).not.toContain('@preview/cheq:0.4.0');
    expect(paths).not.toContain('q.png');
    expect(paths).not.toContain('not a path');
    expect(paths).not.toContain('<svg/>');
  });

  it('reads escapes in the string', () => {
    const [reference] = findPathReferences('#include "a\\\\b.typ"');
    expect(reference.path).toBe('a\\b.typ');
  });

  it('takes every path of a bibliography array', () => {
    expect(findPathReferences('#bibliography(("a.bib", "b.yml"))').map((r) => r.path)).toEqual(['a.bib', 'b.yml']);
  });

  it('also works on a tree parsed elsewhere (e.g. the editor state) and inside a range', () => {
    const tree = typstParser.parse(SOURCE);
    const second = SOURCE.indexOf('#include');
    const found = findPathReferences(SOURCE, { tree, from: second, to: SOURCE.indexOf('#let') });
    expect(found.map((r) => r.path)).toEqual(['chapters/intro.typ', 'img/logo.png']);
  });
});

describe('pathReferenceAt', () => {
  it('finds the reference whose string holds the offset (quotes included)', () => {
    const at = SOURCE.indexOf('template');
    expect(pathReferenceAt(SOURCE, at + 3)?.path).toBe('template.typ');
    expect(pathReferenceAt(SOURCE, at - 1)?.path).toBe('template.typ');
    expect(pathReferenceAt(SOURCE, SOURCE.indexOf('.typ"') + 5)?.path).toBe('template.typ');
    expect(pathReferenceAt(SOURCE, 1)).toBeNull();
    expect(pathReferenceAt(SOURCE, SOURCE.indexOf('not a path'))).toBeNull();
  });
});

describe('describeLink', () => {
  const files = new Set(['/main.typ', '/template.typ', '/chapters/intro.typ']);
  const links: FileLinks = {
    resolve: (reference) => (reference.startsWith('..') ? null : reference.startsWith('/') ? reference : `/${reference}`),
    exists: (path) => files.has(path),
    open: () => {},
    create: async () => null,
  };

  it('describes an existing file', () => {
    expect(describeLink(links, 'template.typ')).toEqual({ path: '/template.typ', name: 'template.typ', exists: true, creatable: false });
  });

  it('offers to create a missing Typst file, not a missing image', () => {
    expect(describeLink(links, 'appendix.typ')).toEqual({ path: '/appendix.typ', name: 'appendix.typ', exists: false, creatable: true });
    expect(describeLink(links, 'logo.png')).toMatchObject({ exists: false, creatable: false });
  });

  it('is null for paths outside the project', () => {
    expect(describeLink(links, '../outside.typ')).toBeNull();
  });
});
