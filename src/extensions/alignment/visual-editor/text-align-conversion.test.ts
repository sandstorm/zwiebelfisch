// Tests for `#align(..)` and alignment set rules in the Typst ↔ ProseMirror conversion (visual-editor.ts, text-align.ts).
import { describe, expect, it } from 'vitest';
import type { Node } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { schema } from '../../../testing/testing';
import { posToSource, serializeToTypst, parseTypst as parseTypstWith, sourceToPos } from '../../../hosts/visual-editor/typst-conversion/typst-conversion';
import { SourceOffset } from '../../../core/typst-document/typst-document';

const parseTypst = (source: string) => parseTypstWith(source, schema);

const FIXTURES: Record<string, string> = {
  inline: '#align(center)[Centered *text*]\n',
  blocks: 'Before\n\n#align(right)[\n  = Title\n\n  Some text.\n\n  - one\n  - two\n]\n\nAfter\n',
  vertical: '#align(top + center)[Hi]\n\n#align(horizon)[There]\n',
  nested: '#align(center)[A\n\n#align(right)[B]]\n',
  empty: '#align(center)[]\n',
  inCell: '#table(columns: 1, [#align(center)[x]], [y])\n',
  justified: '#par(justify: true)[Lorem _ipsum_ dolor]\n\n#par(justify: false)[Ragged]\n',
  justifiedInAlign: '#align(center)[#par(justify: true)[x y]]\n',
  setRules: '#set align(center)\n#set par(justify: true)\n\nText\n',
  raw: '#align(center, [x])\n\n#align(x)[y]\n\n#align(center)[y] tail\n\n#par(justify: true, leading: 1em)[x]\n\n#par(justify: true)[a\n\nb]\n\n#align(center)[open\n',
};

function edit(doc: Node, change: (state: EditorState) => EditorState['tr']): Node {
  const state = EditorState.create({ doc });
  return state.apply(change(state)).doc;
}

function after(doc: Node, text: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text!.includes(text)) found = pos + node.text!.indexOf(text) + text.length;
  });
  if (found < 0) throw new Error(`"${text}" not found`);
  return found;
}

/** Every visible character maps to its source and back; both directions are monotonic. */
function expectPreciseMap(doc: Node): void {
  const source = serializeToTypst(doc);
  doc.descendants((node, pos) => {
    if (!node.isText || node.marks.some((m) => m.type.name === 'typstSource')) return;
    for (let i = 0; i < node.text!.length; i++) {
      const offset = posToSource(doc, pos + i);
      expect(source[offset]).toBe(node.text![i]);
      expect(sourceToPos(doc, offset)).toBe(pos + i);
    }
  });
  let previous = -1;
  for (let offset = 0; offset <= source.length; offset++) {
    const pos = sourceToPos(doc, SourceOffset.of(offset));
    expect(pos).toBeGreaterThanOrEqual(previous);
    expect(sourceToPos(doc, posToSource(doc, pos))).toBe(pos);
    previous = pos;
  }
}

describe('alignment in the Typst ↔ ProseMirror conversion', () => {
  describe('round-trips byte for byte, with a precise position map', () => {
    for (const [name, source] of Object.entries(FIXTURES)) {
      it(name, () => {
        const doc = parseTypst(source);
        expect(serializeToTypst(doc)).toBe(source);
        expectPreciseMap(doc);
      });
    }
  });

  it('parses #align(..)[..] as an alignment block holding editable blocks', () => {
    const doc = parseTypst(FIXTURES.blocks);
    const align = doc.child(1);
    expect(align.type.name).toBe('alignment');
    expect(align.attrs.args).toBe('right');
    expect([...Array(align.childCount).keys()].map((i) => align.child(i).type.name)).toEqual(['heading', 'paragraph', 'bulletList']);
    expect(align.child(0).textContent).toBe('Title');
  });

  it('keeps vertical and nested alignments', () => {
    expect(parseTypst(FIXTURES.vertical).child(0).attrs.args).toBe('top + center');
    expect(parseTypst(FIXTURES.vertical).child(1).attrs.args).toBe('horizon');
    const nested = parseTypst(FIXTURES.nested).child(0);
    expect(nested.child(1).type.name).toBe('alignment');
    expect(nested.child(1).attrs.args).toBe('right');
  });

  it('parses #par(justify: ..)[..] as a paragraph with a justify flag', () => {
    const doc = parseTypst(FIXTURES.justified);
    expect(doc.child(0).type.name).toBe('paragraph');
    expect(doc.child(0).attrs.justify).toBe(true);
    expect(doc.child(0).textContent).toBe('Lorem ipsum dolor');
    expect(doc.child(1).attrs.justify).toBe(false);
    expect(parseTypst('Plain\n').child(0).attrs.justify).toBeNull();
  });

  it('keeps unusual calls raw', () => {
    const doc = parseTypst(FIXTURES.raw);
    const kinds = [...Array(doc.childCount).keys()].map((i) => doc.child(i).type.name);
    expect(kinds).toEqual(['rawBlock', 'rawBlock', 'paragraph', 'rawBlock', 'rawBlock', 'rawBlock']);
  });

  it('typing inside an aligned paragraph changes only that text', () => {
    const doc = edit(parseTypst(FIXTURES.blocks), (s) => s.tr.insertText(' more', after(s.doc, 'Some text')));
    expect(serializeToTypst(doc)).toBe(FIXTURES.blocks.replace('Some text', 'Some text more'));
    expectPreciseMap(doc);
  });

  it('typing inside a justified paragraph keeps its wrapper', () => {
    const doc = edit(parseTypst(FIXTURES.justified), (s) => s.tr.insertText('!', after(s.doc, 'dolor')));
    expect(serializeToTypst(doc)).toBe(FIXTURES.justified.replace('dolor', 'dolor!'));
    expectPreciseMap(doc);
  });

  it('prints a changed alignment by replacing just the argument', () => {
    const doc = edit(parseTypst(FIXTURES.blocks), (s) =>
      s.tr.setNodeMarkup(s.doc.child(0).nodeSize, undefined, { ...s.doc.child(1).attrs, args: 'center' }),
    );
    expect(serializeToTypst(doc)).toBe(FIXTURES.blocks.replace('#align(right)', '#align(center)'));
  });

  it('prints alignment blocks and justified paragraphs made in the editor', () => {
    const doc = edit(parseTypst('A\n\nB\n'), (s) => {
      const tr = s.tr.setNodeMarkup(s.doc.child(0).nodeSize, undefined, { justify: true });
      const range = tr.doc.resolve(1).blockRange(tr.doc.resolve(2))!;
      return tr.wrap(range, [{ type: schema.nodes.alignment, attrs: { args: 'center' } }]);
    });
    expect(serializeToTypst(doc)).toBe('#align(center)[A]\n\n#par(justify: true)[B]\n');
    expectPreciseMap(doc);
  });
});
