// Tests for VisualViewContributions (visual-view.ts): priority, not registration order, decides where contributions
// compete.
import { describe, expect, it } from 'vitest';
import { type BoxRendererProvider, type TypstMarkSpec, type TypstNodeSpec, VisualViewContributions } from './visual-view';

const node = (name: string): TypstNodeSpec => ({ name });
const mark = (name: string): TypstMarkSpec => ({ name, print: () => ({ open: '', close: '' }) });
const renderer = (): BoxRendererProvider => () => null;

describe('VisualViewContributions priority', () => {
  it('orders nodes and marks by priority, higher first (default 100); equal ones in registration order', () => {
    const registry = new VisualViewContributions();
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
    const registry = new VisualViewContributions();
    const snippets = renderer();
    const images = renderer();
    registry.registerBoxRenderer(snippets);
    registry.registerBoxRenderer(images, { priority: 110 });
    expect(registry.contributed().boxRenderers).toEqual([images, snippets]);
  });

  it('takes a disposed registration out', () => {
    const registry = new VisualViewContributions();
    const registration = registry.registerNode(node('a'), { priority: 120 });
    registry.registerNode(node('b'));
    registration.dispose();
    expect(registry.contributed().nodes.map((spec) => spec.name)).toEqual(['b']);
  });
});
