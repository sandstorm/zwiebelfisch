// Tests for VisualViewHost (visual-view.ts) and the specs' order: priority, not registration order, decides where
// contributions compete — box renderers by their registered priority, nodes and marks by their Tiptap extensions'.
import { Mark, Node } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { withHash } from '../../core/typst-syntax/typst-syntax';
import { createSchema, print, project, starterKitPart, type TypstMarkSpec } from '../projection/projection';
import { type BoxRendererProvider, type TypstNodeSpec, VisualViewHost } from './visual-view';

const mark = (name: string, tiptap: TypstMarkSpec['tiptap']): TypstMarkSpec => ({ name, tiptap, typst: { toTypst: () => ({ open: '', close: '' }) } });
const renderer = (): BoxRendererProvider => () => null;

describe('VisualViewHost priority', () => {
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
    const registration = registry.registerNode({ name: 'a' });
    registry.registerNode({ name: 'b' });
    registration.dispose();
    expect(registry.contributed().nodes.map((spec) => spec.name)).toEqual(['b']);
  });
});

describe("the Tiptap extensions' priority", () => {
  const marksOf = (registry: VisualViewHost) => {
    const { nodes, marks } = registry.contributed();
    return Object.keys(createSchema(nodes, marks).marks).filter((name) => name !== 'typstSource');
  };

  it('nests marks by it (outer first), whatever the registration order', () => {
    const registry = new VisualViewHost();
    registry.registerMark(mark('bold', starterKitPart('testBold', { bold: {} })));
    registry.registerMark(mark('inner', Mark.create({ name: 'inner', priority: 90 })));
    registry.registerMark(mark('note', Mark.create({ name: 'note', priority: 120 })));
    expect(marksOf(registry)).toEqual(['note', 'bold', 'inner']);
  });

  it('keeps registration order between marks of equal priority', () => {
    const registry = new VisualViewHost();
    registry.registerMark(mark('a', Mark.create({ name: 'a' })));
    registry.registerMark(mark('b', Mark.create({ name: 'b' })));
    expect(marksOf(registry)).toEqual(['a', 'b']);
  });

  it('asks the parse rules of the spec with the higher priority first', () => {
    // two constructs reading `#rule()`: the later one registered, with the higher priority, claims it
    const atom = (name: string) => Node.create({ name, group: 'block', atom: true, addAttributes: () => ({ src: { default: '' } }) });
    const spec = (name: string, tiptap: TypstNodeSpec['tiptap']): TypstNodeSpec => ({
      name,
      tiptap,
      typst: { parseTypst: { calls: { rule: { block: (p, call) => p.schema.nodes[name].create({ src: p.text(withHash(call)) }) } } } },
    });
    const low = spec('low', atom('low'));
    const high = spec('high', atom('high').extend({ priority: 110 }));
    const doc = project('#rule()\n', createSchema([low, high], []));
    expect(doc.firstChild?.type.name).toBe('high');
    expect(print(doc)).toBe('#rule()\n');
  });
});
