// Tests for the projection of quotes (visual-view.ts).
import { describe, expect, it } from 'vitest';
import { print } from '../../../hosts/visual-view/visual-view';
import { after, edit, expectPreciseMap, find, project, schema } from '../../../testing/testing';

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
        expect(print(project(source))).toBe(source);
        expectPreciseMap(project(source));
      });
    }
  });

  it('projects #quote(block: true)[..] as a blockquote holding blocks', () => {
    const doc = project(FIXTURES.attributed);
    const quote = doc.child(0);
    expect(quote.type.name).toBe('blockquote');
    expect(quote.childCount).toBe(2);
    const first = quote.child(0);
    expect(first.textBetween(0, first.content.size, undefined, ' ')).toBe('First line.');
    expect(quote.child(1).type.name).toBe('bulletList');
  });

  it('projects an empty quote as one empty paragraph', () => {
    const quote = project(FIXTURES.empty).child(0);
    expect(quote.type.name).toBe('blockquote');
    expect(quote.child(0).content.size).toBe(0);
  });

  it('keeps inline and non-block quotes as they are', () => {
    const doc = project(FIXTURES.inline);
    expect(doc.child(0).type.name).toBe('paragraph');
    expect([1, 2, 3].map((i) => doc.child(i).type.name)).toEqual(['rawBlock', 'rawBlock', 'rawBlock']);
  });

  it('editing quoted text changes only that text, keeping the other arguments', () => {
    const doc = edit(project(FIXTURES.attributed), (s) => s.tr.insertText(' Really', after(s.doc, 'line.')));
    expect(print(doc)).toBe(FIXTURES.attributed.replace('line.', 'line. Really'));
    expectPreciseMap(doc);
  });

  it('typing into an empty quote fills its brackets', () => {
    const doc = edit(project(FIXTURES.empty), (s) => s.tr.insertText('Hi', 2));
    expect(print(doc)).toBe('#quote(block: true)[Hi]\n');
  });

  it('adding a paragraph to a quote separates it with a blank line', () => {
    const doc = edit(project(FIXTURES.quote), (s) => {
      const { node, pos } = find(s.doc, 'blockquote');
      return s.tr.insert(pos + node.nodeSize - 1, schema.nodes.paragraph.create(null, schema.text('More')));
    });
    expect(print(doc)).toBe('Before\n\n#quote(block: true)[Quoted *text*\n\nMore]\n\nAfter\n');
    expectPreciseMap(doc);
  });

  it('prints a quote created in the editor, escaping a closing bracket', () => {
    const doc = edit(project('Text\n'), (s) => {
      const quote = schema.nodes.blockquote.create(null, schema.nodes.paragraph.create(null, schema.text('a ] b')));
      return s.tr.insert(s.doc.content.size, quote);
    });
    expect(print(doc)).toBe('Text\n\n#quote(block: true)[a \\] b]\n');
    expectPreciseMap(doc);
  });

  it('lifting the content out of a quote leaves its paragraphs', () => {
    const doc = edit(project(FIXTURES.quote), (s) => {
      const { node, pos } = find(s.doc, 'blockquote');
      return s.tr.replaceWith(pos, pos + node.nodeSize, node.content);
    });
    expect(print(doc)).toBe('Before\n\nQuoted *text*\n\nAfter\n');
  });
});
