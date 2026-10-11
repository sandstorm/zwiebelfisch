// Tests for mermaid-figure.ts: the figure and the import of `mermaid` it needs.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { SourceOffset } from '../../../core/typst-document/typst-document';
import { calculateMermaidFigure, isMermaid } from './mermaid-figure';

const path = ProjectPath.of;

/** `text` of `file` with the import applied, and the figure of `diagram` used at its end. */
function figure(text: string, diagram: string, file = '/main.typ') {
  const { source, importChange: change } = calculateMermaidFigure(text, path(file), path(diagram), SourceOffset.of(text.length));
  return { source, text: change ? text.slice(0, change.from) + change.insert + text.slice(change.to) : text };
}

describe('calculateMermaidFigure', () => {
  it('reads the file relative to the document and imports mermaid from merman at the top, a blank line after it', () => {
    expect(figure('= Method\n', '/diagrams/loop.mmd')).toEqual({
      source: '#figure(mermaid(read("diagrams/loop.mmd"), width: 100%), caption: [ ])',
      text: '#import "@preview/merman:0.4.0": mermaid\n\n= Method\n',
    });
    expect(figure('Text\n', '/diagrams/loop.mmd', '/chapters/method.typ').source).toBe('#figure(mermaid(read("/diagrams/loop.mmd"), width: 100%), caption: [ ])');
  });

  it('uses an import of merman of any version, adding mermaid to it where missing', () => {
    expect(figure('#import "@preview/merman:0.3.0": mermaid\n', '/a.mmd').text).toBe('#import "@preview/merman:0.3.0": mermaid\n');
    expect(figure('#import "@preview/merman:0.4.0": show-mermaid-blocks\n', '/a.mmd').text).toBe('#import "@preview/merman:0.4.0": show-mermaid-blocks, mermaid\n');
  });
});

describe('isMermaid', () => {
  it('tells Mermaid files by name', () => {
    expect(isMermaid(path('/d/Flow.MMD'))).toBe(true);
    expect(isMermaid(path('/d/flow.md'))).toBe(false);
  });
});
