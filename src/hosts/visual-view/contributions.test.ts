// Tests for VisualViewHost (visual-view.ts): priority, not registration order, decides where contributions
// compete.
import { Mark } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { createSchema, starterKitPart } from '../projection/projection';
import { type BoxRendererProvider, type TypstMarkSpec, type TypstNodeSpec, VisualViewHost } from './visual-view';

const node = (name: string): TypstNodeSpec => ({ name });
const mark = (name: string): TypstMarkSpec => ({ name, print: () => ({ open: '', close: '' }) });
const renderer = (): BoxRendererProvider => () => null;

describe('VisualViewHost priority', () => {
  it('orders nodes and marks by priority, higher first (default 100); equal ones in registration order', () => {
    const registry = new VisualViewHost();
    registry.registerNode(node('a'));
    registry.registerNode(node('low'), { priority: 50 });
    registry.registerNode(node('b'));
    registry.registerNode(node('high'), { priority: 110 });
    registry.registerMark(mark('inner'), { priority: 90 });
    registry.registerMark(mark('outer'));
    const { nodes, marks } = registry.contributed();
    expect(nodes.map((spec) => spec.name)).toEqual(['high', 'a', 'b', 'low']);
    expect(marks.map((spec) => spec.name)).toEqual(['outer', 'inner']);
  });

  it('asks box renderers by priority: one registered later with a higher priority comes first', () => {
    const registry = new VisualViewHost();
    const snippets = renderer();
    const images = renderer();
    registry.registerBoxRenderer(snippets);
    registry.registerBoxRenderer(images, { priority: 110 });
    expect(registry.contributed().boxRenderers).toEqual([images, snippets]);
  });

  it('takes a disposed registration out', () => {
    const registry = new VisualViewHost();
    const registration = registry.registerNode(node('a'), { priority: 120 });
    registry.registerNode(node('b'));
    registration.dispose();
    expect(registry.contributed().nodes.map((spec) => spec.name)).toEqual(['b']);
  });
});

describe('VisualViewHost mark priority', () => {
  const marksOf = (registry: VisualViewHost) => {
    const { nodes, marks } = registry.contributed();
    return Object.keys(createSchema(nodes, marks).marks).filter((name) => name !== 'typstSource');
  };

  it("nests marks by the registered priority, whatever their Tiptap extensions' own (outer first)", () => {
    const registry = new VisualViewHost();
    // Tiptap's link mark has priority 1000, which would put it outside everything
    registry.registerMark({ ...mark('link'), extension: starterKitPart('testLink', { link: {} }) }, { priority: 90 });
    registry.registerMark({ ...mark('bold'), extension: starterKitPart('testBold', { bold: {} }) });
    registry.registerMark({ ...mark('note'), extension: Mark.create({ name: 'note', priority: 1 }) }, { priority: 120 });
    expect(marksOf(registry)).toEqual(['note', 'bold', 'link']);
  });

  it('keeps registration order between marks of equal priority', () => {
    const registry = new VisualViewHost();
    registry.registerMark({ ...mark('a'), extension: Mark.create({ name: 'a', priority: 50 }) });
    registry.registerMark({ ...mark('b'), extension: Mark.create({ name: 'b', priority: 500 }) });
    expect(marksOf(registry)).toEqual(['a', 'b']);
  });
});
