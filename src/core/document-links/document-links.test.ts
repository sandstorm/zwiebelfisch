// Tests for document-links.ts: DocumentLinkProvider (and find-links.ts).
import { describe, expect, it, vi } from 'vitest';
import { typstParser } from 'codemirror-lang-typst/lezer';
import { DocumentLinkProvider, type LinkWorkspace } from './document-links';

const files = new Set(['/main.typ', '/template.typ', '/chapters/intro.typ']);

function workspace(): LinkWorkspace {
  return {
    resolve: (reference) => (reference.startsWith('..') ? null : reference.startsWith('/') ? reference : `/${reference}`),
    exists: (path) => files.has(path),
    open: vi.fn(),
    create: vi.fn(async () => null),
  };
}

const provider = new DocumentLinkProvider(workspace());

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

describe('provideDocumentLinks', () => {
  it('lists the file paths of imports, includes and file-reading calls, in order', () => {
    const found = provider.provideDocumentLinks(SOURCE);
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
    for (const reference of provider.provideDocumentLinks(SOURCE)) expect(text(reference.from, reference.to)).toBe(reference.path);
  });

  it('skips packages, named arguments, other calls, methods and empty strings', () => {
    const paths = provider.provideDocumentLinks(SOURCE).map((r) => r.path);
    expect(paths).not.toContain('@preview/cheq:0.4.0');
    expect(paths).not.toContain('q.png');
    expect(paths).not.toContain('not a path');
    expect(paths).not.toContain('<svg/>');
  });

  it('reads escapes in the string', () => {
    const [reference] = provider.provideDocumentLinks('#include "a\\\\b.typ"');
    expect(reference.path).toBe('a\\b.typ');
  });

  it('takes every path of a bibliography array', () => {
    expect(provider.provideDocumentLinks('#bibliography(("a.bib", "b.yml"))').map((r) => r.path)).toEqual(['a.bib', 'b.yml']);
  });

  it('also works on a tree parsed elsewhere (e.g. the editor state) and inside a range', () => {
    const tree = typstParser.parse(SOURCE);
    const second = SOURCE.indexOf('#include');
    const found = provider.provideDocumentLinks(SOURCE, { tree, from: second, to: SOURCE.indexOf('#let') });
    expect(found.map((r) => r.path)).toEqual(['chapters/intro.typ', 'img/logo.png']);
  });
});

describe('documentLinkAt', () => {
  it('finds the reference whose string holds the offset (quotes included)', () => {
    const at = SOURCE.indexOf('template');
    expect(provider.documentLinkAt(SOURCE, at + 3)?.path).toBe('template.typ');
    expect(provider.documentLinkAt(SOURCE, at - 1)?.path).toBe('template.typ');
    expect(provider.documentLinkAt(SOURCE, SOURCE.indexOf('.typ"') + 5)?.path).toBe('template.typ');
    expect(provider.documentLinkAt(SOURCE, 1)).toBeNull();
    expect(provider.documentLinkAt(SOURCE, SOURCE.indexOf('not a path'))).toBeNull();
  });
});

describe('resolveDocumentLink', () => {
  it('describes an existing file', () => {
    expect(provider.resolveDocumentLink('template.typ')).toEqual({ path: '/template.typ', name: 'template.typ', exists: true, creatable: false });
  });

  it('offers to create a missing Typst file, not a missing image', () => {
    expect(provider.resolveDocumentLink('appendix.typ')).toEqual({ path: '/appendix.typ', name: 'appendix.typ', exists: false, creatable: true });
    expect(provider.resolveDocumentLink('logo.png')).toMatchObject({ exists: false, creatable: false });
  });

  it('is null for paths outside the project', () => {
    expect(provider.resolveDocumentLink('../outside.typ')).toBeNull();
  });
});

describe('followDocumentLink', () => {
  it('opens an existing file, creates a missing Typst file, and refuses a missing image', async () => {
    const files = workspace();
    const links = new DocumentLinkProvider(files);
    expect(await links.followDocumentLink(links.resolveDocumentLink('template.typ')!)).toBeNull();
    expect(files.open).toHaveBeenCalledWith('/template.typ');
    expect(await links.followDocumentLink(links.resolveDocumentLink('appendix.typ')!)).toBeNull();
    expect(files.create).toHaveBeenCalledWith('/appendix.typ');
    expect(await links.followDocumentLink(links.resolveDocumentLink('logo.png')!)).toBe('logo.png is not in the project.');
  });
});
