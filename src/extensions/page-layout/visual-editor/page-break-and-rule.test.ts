// Tests for page-break.ts and horizontal-rule.ts: `#pagebreak()` and full-width `#line(..)` as widgets.
import { describe, expect, it } from 'vitest';
import { serializeToTypst } from '../../../hosts/prosemirror-typst/prosemirror-typst';
import { after, edit, expectPreciseMap, parseTypst, schema } from '../../../testing/testing';

const FIXTURES: Record<string, string> = {
  pageBreaks: 'One\n\n#pagebreak()\n\nTwo\n\n#pagebreak(weak: true)\n',
  rules: 'Above\n\n#line(length: 100%)\n\n#line(length: 100%, stroke: 0.5pt + gray)\n\nBelow\n',
  notRules: '#line(length: 50%)\n\n#line(start: (0pt, 0pt), length: 100%)\n\n#line()\n\nA #line(length: 100%) inline\n',
};

describe('page breaks and horizontal rules', () => {
  describe('round-trip byte for byte, with a precise position map', () => {
    for (const [name, source] of Object.entries(FIXTURES)) {
      it(name, () => {
        expect(serializeToTypst(parseTypst(source))).toBe(source);
        expectPreciseMap(parseTypst(source));
      });
    }
  });

  it('parses a standalone #pagebreak(..) as a page break, keeping its arguments', () => {
    const doc = parseTypst(FIXTURES.pageBreaks);
    expect(doc.child(1).type.name).toBe('pageBreak');
    expect(doc.child(1).attrs.src).toBe('#pagebreak()');
    expect(doc.child(3).type.name).toBe('pageBreak');
    expect(doc.child(3).attrs.src).toBe('#pagebreak(weak: true)');
  });

  it('parses a full-width #line as a horizontal rule', () => {
    const doc = parseTypst(FIXTURES.rules);
    expect(doc.child(1).type.name).toBe('horizontalRule');
    expect(doc.child(2).type.name).toBe('horizontalRule');
    expect(doc.child(2).attrs.src).toBe('#line(length: 100%, stroke: 0.5pt + gray)');
  });

  it('keeps other lines raw: partial length, positioned, default, inline', () => {
    const doc = parseTypst(FIXTURES.notRules);
    expect([0, 1, 2].map((i) => doc.child(i).type.name)).toEqual(['rawBlock', 'rawBlock', 'rawBlock']);
    expect(doc.child(3).type.name).toBe('paragraph');
  });

  it('keeps calls with a trailing content block or a field access raw', () => {
    for (const src of ['#pagebreak()[x]', '#pagebreak().x', '#line(length: 100%)[x]']) {
      expect(parseTypst(src).child(0).type.name, src).toBe('rawBlock');
    }
  });

  it('prints page breaks and rules created in the editor', () => {
    const doc = edit(parseTypst('Text\n'), (s) =>
      s.tr.insert(s.doc.content.size, [schema.nodes.pageBreak.create(), schema.nodes.horizontalRule.create()]),
    );
    expect(serializeToTypst(doc)).toBe('Text\n\n#pagebreak()\n\n#line(length: 100%)\n');
    expectPreciseMap(doc);
  });

  it('marks a page break\'s DOM as owning its pseudo-elements (its dashed lines)', () => {
    const [, attrs] = schema.nodes.pageBreak.spec.toDOM!(schema.nodes.pageBreak.create()) as [string, Record<string, string>];
    expect(attrs['data-zwf-pseudo']).toBe('own');
  });

  it('deleting a page break removes just its source', () => {
    const source = 'One\n\n#pagebreak()\n\nTwo\n';
    const doc = edit(parseTypst(source), (s) => s.tr.delete(after(s.doc, 'One') + 1, after(s.doc, 'One') + 2));
    expect(serializeToTypst(doc)).toBe('One\n\nTwo\n');
  });
});
