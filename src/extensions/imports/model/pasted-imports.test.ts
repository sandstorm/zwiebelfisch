// Tests for pasted-imports.ts: the imports copied Typst needs, and the imports a paste adds.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { SourceOffset } from '../../../core/typst-document/typst-document';
import { calculatePastedImports, copiedImports, parseCopiedImports } from './pasted-imports';

const path = ProjectPath.of;
const FIGURE = '#figure(\n  mermaid(read("../diagrams/workbench-layout.mmd"), width: 75%),\n  caption: [The editor: …],\n)';
const MERMAN = { name: 'mermaid', module: '@preview/merman:0.4.0' };

/** The text of `/book/two/b.typ` after `pasted` is appended to `before` and the imports are added (before the end). */
function paste(before: string, pasted: string, copied = parseCopiedImports('[]'), known = [MERMAN]): string {
  const end = SourceOffset.of(before.length);
  const changes = calculatePastedImports({ path: path('/book/two/b.typ'), text: before }, { ranges: [{ from: end, to: end }], text: pasted }, copied, known);
  expect(changes.length).toBeLessThanOrEqual(1);
  const [change] = changes;
  return (change ? before.slice(0, change.from) + change.insert + before.slice(change.to) : before) + pasted;
}

describe('copiedImports', () => {
  it('lists the imports the copied text uses, file modules as project paths, packages as written', () => {
    const text = '#import "../template.typ": mermaid, note as n, unused\n#import "@preview/cetz:0.3.0": canvas\n#import "all.typ": *\n\nText\n';
    expect(copiedImports(text, path('/book/one/a.typ'), `${FIGURE} #n[x] #canvas()`)).toEqual([
      { module: '/book/template.typ', item: 'mermaid' },
      { module: '/book/template.typ', item: 'note as n' },
      { module: '@preview/cetz:0.3.0', item: 'canvas' },
    ]);
  });

  it('leaves out names only fields and argument names spell (`x.mermaid`, `mermaid: 1`)', () => {
    expect(copiedImports('#import "t.typ": mermaid\n', path('/a.typ'), '#f(mermaid: 1) #x.mermaid')).toEqual([]);
  });
});

describe('parseCopiedImports', () => {
  it('reads the clipboard\'s JSON, dropping what is no copied import', () => {
    const json = JSON.stringify([
      { module: '/book/template.typ', item: 'mermaid' },
      { module: 'relative.typ', item: 'a' },
      { module: '@preview/x:1.0.0', item: 'a"; #evil' },
      { module: '@preview/x:1.0.0', item: 'a as b' },
    ]);
    expect(parseCopiedImports(json)).toEqual([
      { module: '/book/template.typ', item: 'mermaid' },
      { module: '@preview/x:1.0.0', item: 'a as b' },
    ]);
    expect(parseCopiedImports('not json')).toEqual([]);
  });
});

describe('calculatePastedImports', () => {
  it('imports a name the paste uses from the copied file, the path written from the target file, at the top', () => {
    const copied = [{ module: '/book/template.typ', item: 'mermaid' }];
    expect(paste('= B\n\n', FIGURE, copied)).toBe(`#import "/book/template.typ": mermaid\n\n= B\n\n${FIGURE}`);
    expect(paste('= B\n\n', FIGURE, [{ module: '/book/two/t.typ', item: 'mermaid' }])).toBe(`#import "t.typ": mermaid\n\n= B\n\n${FIGURE}`);
  });

  it('adds the name to an import of the same file, however written', () => {
    const copied = [{ module: '/book/template.typ', item: 'mermaid' }];
    expect(paste('#import "../template.typ": note\n\n', FIGURE, copied)).toBe(`#import "../template.typ": note, mermaid\n\n${FIGURE}`);
  });

  it('imports what an extension declares when nothing was copied with the text; a package of any version takes it', () => {
    expect(paste('Text\n\n', FIGURE)).toBe(`#import "@preview/merman:0.4.0": mermaid\n\nText\n\n${FIGURE}`);
    expect(paste('#import "@preview/merman:0.3.0": other\n', FIGURE)).toBe(`#import "@preview/merman:0.3.0": other, mermaid\n${FIGURE}`);
  });

  it('prefers the copied file\'s import to a declared one', () => {
    expect(paste('', FIGURE, [{ module: '/book/template.typ', item: 'mermaid' }])).toBe(`#import "/book/template.typ": mermaid\n\n${FIGURE}`);
  });

  it('imports nothing the file defines, imports (by name, or with * from the module) or used before', () => {
    expect(paste('#let mermaid(..args) = none\n', FIGURE)).toBe(`#let mermaid(..args) = none\n${FIGURE}`);
    expect(paste('#import "x.typ": m as mermaid\n', FIGURE)).toBe(`#import "x.typ": m as mermaid\n${FIGURE}`);
    expect(paste('#import "@preview/merman:0.4.0": *\n', FIGURE)).toBe(`#import "@preview/merman:0.4.0": *\n${FIGURE}`);
    expect(paste('#mermaid("a")\n', FIGURE)).toBe(`#mermaid("a")\n${FIGURE}`);
    expect(paste('Text ', '*bold* and #undeclared()')).toBe('Text *bold* and #undeclared()');
  });

  it('imports nothing the pasted text imports itself', () => {
    const changes = calculatePastedImports({ path: path('/b.typ'), text: 'Text\n' }, { ranges: [{ from: SourceOffset.of(5), to: SourceOffset.of(5) }], text: `#import "x.typ": mermaid\n${FIGURE}` }, [], [MERMAN]);
    expect(changes).toEqual([]);
  });

  it('imports several names of one file in one import, renamed ones as they were', () => {
    const copied = [
      { module: '/book/template.typ', item: 'mermaid' },
      { module: '/book/template.typ', item: 'note as n' },
    ];
    expect(paste('', `${FIGURE}\n#n[x]`, copied)).toBe(`#import "/book/template.typ": mermaid, note as n\n\n${FIGURE}\n#n[x]`);
  });
});
