// Tests for typst-syntax.ts: findFilePaths and reading calls.
import { typstParser } from 'codemirror-lang-typst/lezer';
import { describe, expect, it } from 'vitest';
import { callArguments, calleeName, findFilePaths, hasOnlyArguments, namedArgument, syntaxTree, trailingContent, withHash } from './typst-syntax';
import { SourceOffset, TypstDocument } from '../typst-document/typst-document';

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

describe('syntaxTree', () => {
  it('parses a text on every call, keeps nothing between calls', () => {
    expect(syntaxTree('= A')).not.toBe(syntaxTree('= A'));
  });

  it("is a TypstDocument's own tree of its current text", () => {
    const document = new TypstDocument('= A');
    expect(syntaxTree(document)).toBe(document.syntaxTree);
    document.change([{ from: SourceOffset.of(3), to: SourceOffset.of(3), insert: 'B' }], 'test');
    expect(syntaxTree(document)).toBe(document.syntaxTree);
    expect(syntaxTree(document).length).toBe(4);
  });

  it('parses another holder of a text once, and two holders of the same text each', () => {
    const first = { text: '= A' };
    const second = { text: '= A' };
    expect(syntaxTree(first)).toBe(syntaxTree(first));
    expect(syntaxTree(second)).not.toBe(syntaxTree(first));
  });
});

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

describe('reading calls', () => {
  /** The first `FuncCall` of `source`. */
  const callIn = (source: string) => {
    const cursor = typstParser.parse(source).cursor();
    while (cursor.name !== 'FuncCall' && cursor.next());
    return cursor.node;
  };
  const texts = (source: string, nodes: readonly { from: number; to: number }[] | null) => nodes?.map((n) => source.slice(n.from, n.to)) ?? null;

  it('names the callee, if it is a plain name', () => {
    expect(calleeName(callIn('#table(a)'), '#table(a)')).toBe('table');
    expect(calleeName(callIn('#table.header(a)'), '#table.header(a)')).toBe('');
  });

  it('lists the arguments in the parentheses, comments kept and separators left out', () => {
    const source = '#f(a, b: 1 /* c */)[x]';
    expect(texts(source, callArguments(callIn(source)))).toEqual(['a', 'b: 1', '/* c */']);
    expect(callArguments(callIn('#f[x]'))).toEqual([]);
    expect(callArguments(callIn('#f(a'))).toEqual([]);
  });

  it('reads a named argument\'s value', () => {
    const source = '#figure(image("a.png"), caption: [Hi])';
    expect(texts(source, [namedArgument(callIn(source), 'caption', source)!])).toEqual(['[Hi]']);
    expect(namedArgument(callIn(source), 'kind', source)).toBeNull();
  });

  it('gives the closed content blocks after the parentheses, or null', () => {
    const source = '#f(a)[x][y]';
    expect(texts(source, trailingContent(callIn(source)))).toEqual(['[x]', '[y]']);
    expect(texts('#f[x]', trailingContent(callIn('#f[x]')))).toEqual(['[x]']);
    expect(trailingContent(callIn('#f(a)'))).toEqual([]);
    expect(trailingContent(callIn('#f(a)[x'))).toBeNull();
    expect(trailingContent(callIn('#f(a [x]'))).toBeNull();
  });

  it('tells a call with only parenthesized arguments', () => {
    expect(hasOnlyArguments(callIn('#pagebreak()'))).toBe(true);
    expect(hasOnlyArguments(callIn('#f(a)[x]'))).toBe(false);
    expect(hasOnlyArguments(callIn('#f[x]'))).toBe(false);
    expect(hasOnlyArguments(callIn('#f(a'))).toBe(false);
  });

  it('takes the `#` before a call in markup along', () => {
    expect(withHash(callIn('A #f(a) b'))).toEqual({ from: 2, to: 7 });
    expect(withHash(callIn('#figure(table(a))').getChild('Args')!.getChild('FuncCall')!)).toEqual({ from: 8, to: 16 });
  });
});
