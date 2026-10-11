// Tests for quotes in the Typst ↔ ProseMirror conversion (visual-editor.ts).
import { describe, expect, it } from 'vitest';
import { serializeToTypst } from '../../../hosts/prosemirror-typst/prosemirror-typst';
import { after, edit, expectPreciseMap, find, parseTypst, schema } from '../../../testing/testing';

const FIXTURES: Record<string, string> = {
  quote: 'Before\n\n#quote(block: true)[Quoted *text*]\n\nAfter\n',
  attributed: '#quote(block: true, attribution: [Ada])[\n  First\n  line.\n\n  - a list\n]\n',
  empty: '#quote(block: true)[]\n',
  inline: 'Say #quote[hi] now\n\n#quote[not a block]\n\n#quote(block: false)[x]\n\n#quote(block: true, [x])\n',
};

describe('block quotes', () => {
  describe('round-trip byte for byte, with a precise position map', () => {
    for (const [name, source] of Object.entries(FIXTURES)) {
      it(name, () => {
        expect(serializeToTypst(parseTypst(source))).toBe(source);
        expectPreciseMap(parseTypst(source));
      });
    }
  });

  it('parses #quote(block: true)[..] as a blockquote holding blocks', () => {
    const doc = parseTypst(FIXTURES.attributed);
    const quote = doc.child(0);
    expect(quote.type.name).toBe('blockquote');
    expect(quote.childCount).toBe(2);
    const first = quote.child(0);
    expect(first.textBetween(0, first.content.size, undefined, ' ')).toBe('First line.');
    expect(quote.child(1).type.name).toBe('bulletList');
  });

  it('parses an empty quote as one empty paragraph', () => {
    const quote = parseTypst(FIXTURES.empty).child(0);
    expect(quote.type.name).toBe('blockquote');
    expect(quote.child(0).content.size).toBe(0);
  });

  it('keeps inline and non-block quotes as they are', () => {
    const doc = parseTypst(FIXTURES.inline);
    expect(doc.child(0).type.name).toBe('paragraph');
    expect([1, 2, 3].map((i) => doc.child(i).type.name)).toEqual(['rawBlock', 'rawBlock', 'rawBlock']);
  });

  it('editing quoted text changes only that text, keeping the other arguments', () => {
    const doc = edit(parseTypst(FIXTURES.attributed), (s) => s.tr.insertText(' Really', after(s.doc, 'line.')));
    expect(serializeToTypst(doc)).toBe(FIXTURES.attributed.replace('line.', 'line. Really'));
    expectPreciseMap(doc);
  });

  it('typing into an empty quote fills its brackets', () => {
    const doc = edit(parseTypst(FIXTURES.empty), (s) => s.tr.insertText('Hi', 2));
    expect(serializeToTypst(doc)).toBe('#quote(block: true)[Hi]\n');
  });

  it('adding a paragraph to a quote separates it with a blank line', () => {
    const doc = edit(parseTypst(FIXTURES.quote), (s) => {
      const { node, pos } = find(s.doc, 'blockquote');
      return s.tr.insert(pos + node.nodeSize - 1, schema.nodes.paragraph.create(null, schema.text('More')));
    });
    expect(serializeToTypst(doc)).toBe('Before\n\n#quote(block: true)[Quoted *text*\n\nMore]\n\nAfter\n');
    expectPreciseMap(doc);
  });

  it('prints a quote created in the editor, escaping a closing bracket', () => {
    const doc = edit(parseTypst('Text\n'), (s) => {
      const quote = schema.nodes.blockquote.create(null, schema.nodes.paragraph.create(null, schema.text('a ] b')));
      return s.tr.insert(s.doc.content.size, quote);
    });
    expect(serializeToTypst(doc)).toBe('Text\n\n#quote(block: true)[a \\] b]\n');
    expectPreciseMap(doc);
  });

  it('lifting the content out of a quote leaves its paragraphs', () => {
    const doc = edit(parseTypst(FIXTURES.quote), (s) => {
      const { node, pos } = find(s.doc, 'blockquote');
      return s.tr.replaceWith(pos, pos + node.nodeSize, node.content);
    });
    expect(serializeToTypst(doc)).toBe('Before\n\nQuoted *text*\n\nAfter\n');
  });
});
