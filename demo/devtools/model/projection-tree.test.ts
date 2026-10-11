// Tests for projection-tree.ts.
import { describe, expect, it } from 'vitest';
import type { SourceOffset } from '../../../src';
import { projectionRows, type ProjectionNode } from './projection-tree';

/** A ProseMirror-shaped node: sizes as ProseMirror counts them (text: its length; others: content + 2, leaves 1). */
class TestNode implements ProjectionNode<TestNode> {
  readonly type: { name: string };
  readonly marks: { type: { name: string } }[];
  readonly isText: boolean;

  readonly text?: string;

  constructor(
    name: string,
    readonly attrs: Record<string, unknown> = {},
    readonly content: TestNode[] = [],
    { text, marks = [] }: { text?: string; marks?: string[] } = {},
  ) {
    this.type = { name };
    this.text = text;
    this.isText = text !== undefined;
    this.marks = marks.map((mark) => ({ type: { name: mark } }));
  }

  get nodeSize(): number {
    if (this.text !== undefined) return this.text.length;
    const inner = this.content.reduce((size, node) => size + node.nodeSize, 0);
    return this.type.name === 'rawBlock' ? 1 : inner + 2;
  }

  forEach(f: (node: TestNode, offset: number) => void): void {
    let offset = 0;
    for (const node of this.content) {
      f(node, offset);
      offset += node.nodeSize;
    }
  }
}

const text = (value: string, ...marks: string[]) => new TestNode('text', {}, [], { text: value, marks });

describe('projectionRows', () => {
  // `= Hi *you*\n\n#foo()`: a heading (its markup hidden) and a raw box
  const doc = new TestNode('doc', { lead: '' }, [
    new TestNode('heading', { level: 1, src: '= Hi *you*', sep: '\n\n', label: null }, [text('Hi '), text('you', 'bold')]),
    new TestNode('rawBlock', { src: '#foo()', sep: null }),
  ]);
  // positions → source offsets in that text: where what starts there begins, and (bias -1) where what ends there
  // ends; the heading's content ends at position 7, after "you" (its closing `*` hidden)
  const starts = new Map([[0, 0], [1, 2], [4, 6], [8, 12]]);
  const ends = new Map([[4, 5], [7, 9], [9, 18]]);
  const mapping = {
    posToSource: (pos: number, bias?: 1 | -1) => ((bias === -1 ? ends : starts).get(pos) ?? -1) as SourceOffset,
    isBox: (node: TestNode) => node.type.name === 'rawBlock',
  };

  it('lists the nodes depth first, with positions, source ranges and what they keep', () => {
    expect(projectionRows(doc, mapping)).toEqual([
      { depth: 0, name: 'heading', pos: 0, end: 8, range: { from: 0, to: 9 }, box: false, detail: '"= Hi *you*"', marks: [], attributes: '{ level: 1, sep: "⏎⏎" }' },
      { depth: 1, name: 'text', pos: 1, end: 4, range: { from: 2, to: 5 }, box: false, detail: '"Hi "', marks: [], attributes: '' },
      { depth: 1, name: 'text', pos: 4, end: 7, range: { from: 6, to: 9 }, box: false, detail: '"you"', marks: ['bold'], attributes: '' },
      { depth: 0, name: 'rawBlock', pos: 8, end: 9, range: { from: 12, to: 18 }, box: true, detail: '"#foo()"', marks: [], attributes: '' },
    ]);
  });
});
