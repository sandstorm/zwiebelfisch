// Tests for changes-since.ts.
import type { Node } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { parseTypst } from '../../../testing/testing';
import { changesSince } from './changes-since';

/** The changes from `original` to `current`, the inserted ranges as the document's text there. */
function changes(original: string, current: string) {
  const doc = parseTypst(current);
  const { inserted, deleted } = changesSince(original, doc);
  return { inserted: inserted.map(({ from, to }) => text(doc, from, to)), deleted: deleted.map(({ lines, inline }) => ({ lines, inline })), doc, positions: deleted.map((d) => d.pos) };
}

function text(doc: Node, from: number, to: number): string {
  return doc.textBetween(from, to, '|', (leaf) => (typeof leaf.attrs.src === 'string' ? leaf.attrs.src : ''));
}

describe('changesSince', () => {
  it('finds nothing in an unchanged document', () => {
    const source = '= Intro\n\nSome *bold* text.\n\n#table(columns: 2, [a], [b])\n';
    expect(changes(source, source)).toMatchObject({ inserted: [], deleted: [] });
  });

  it('marks words inserted and deleted in a paragraph, the deletion inline where it was', () => {
    const { inserted, deleted, doc, positions } = changes('The quick fox.\n', 'The slow brown fox.\n');
    expect(inserted).toEqual(['slow brown']);
    expect(deleted).toEqual([{ lines: ['quick'], inline: true }]);
    expect(doc.textBetween(1, positions[0])).toBe('The ');
  });

  it('shows a deleted paragraph as a block, an inserted one as inserted', () => {
    expect(changes('One.\n\nTwo.\n\nThree.\n', 'One.\n\nThree.\n\nFour.\n')).toMatchObject({
      inserted: [expect.stringContaining('Four')],
      deleted: [{ lines: expect.arrayContaining(['Two.']) }],
    });
  });

  it('counts a format applied as the text replaced', () => {
    expect(changes('Some text.\n', 'Some *text*.\n')).toMatchObject({ inserted: ['text'], deleted: [{ lines: ['text'], inline: true }] });
  });

  it('marks a block whose attributes changed (a heading\'s level) from its start', () => {
    const { doc } = changes('= A\n', '== A\n');
    expect(changesSince('= A\n', doc).inserted).toEqual([{ from: 0, to: 1 }]);
  });

  it('marks a box whose Typst changed as inserted only', () => {
    expect(changes('Before.\n\n#rect(width: 1cm)\n', 'Before.\n\n#rect(width: 2cm)\n')).toMatchObject({ inserted: ['#rect(width: 2cm)'], deleted: [] });
  });

  it('finds an edit in a table cell', () => {
    expect(changes('#table(columns: 2, [a], [b])\n', '#table(columns: 2, [a], [c])\n')).toMatchObject({ inserted: ['c'], deleted: [{ lines: ['b'], inline: true }] });
  });

  it('marks everything of a new file as inserted, nothing of an emptied one', () => {
    expect(changes('', '= Intro\n\nText.\n')).toMatchObject({ inserted: ['Intro|Text.'], deleted: [] });
    expect(changes('= Intro\n\nText.\n', '').deleted).toEqual([{ lines: ['Intro', 'Text.'], inline: false }]);
  });
});
