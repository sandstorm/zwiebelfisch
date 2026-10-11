// Tests for the projection of table header rows (visual-view.ts, through the projection).
import type { Node } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { serializeToTypst } from '../../../hosts/projection/projection';
import { after, edit, expectPreciseMap, find, parseTypst, schema } from '../../../testing/testing';

const FIXTURES: Record<string, string> = {
  parens: '#table(\n  columns: 2,\n  table.header([Name], [*Qty*]),\n  [a], [1],\n  [b], [2],\n)\n',
  brackets: '#table(columns: 2, table.header[H1][H2], [a], [b])\n',
  notModelled:
    '#table(columns: 2, table.header([a]), [c], [d])\n\n#table(columns: 1, table.header(repeat: false, [a]), [b])\n\n' +
    '#table(columns: 1, [a], table.header([b]))\n\n#table(columns: 1, table.header([a]), table.header([b]))\n',
};

const cellTypes = (table: Node) => {
  const rows: string[][] = [];
  table.forEach((row) => {
    const types: string[] = [];
    row.forEach((cell) => types.push(cell.type.name));
    rows.push(types);
  });
  return rows;
};

/** Changes the cells of the first row of the first table to `type`, as Tiptap's toggleHeaderRow does. */
function setFirstRow(doc: Node, type: 'tableHeader' | 'tableCell'): Node {
  return edit(doc, (s) => {
    const { pos } = find(s.doc, 'tableRow');
    const tr = s.tr;
    s.doc.nodeAt(pos)!.forEach((_cell, offset) => tr.setNodeMarkup(pos + 1 + offset, schema.nodes[type]));
    return tr;
  });
}

describe('table headers', () => {
  describe('round-trip byte for byte, with a precise position map', () => {
    for (const [name, source] of Object.entries(FIXTURES)) {
      it(name, () => {
        expect(serializeToTypst(parseTypst(source))).toBe(source);
        expectPreciseMap(parseTypst(source));
      });
    }
  });

  it('projects table.header(..) as a first row of header cells', () => {
    const table = parseTypst(FIXTURES.parens).child(0);
    expect(table.type.name).toBe('table');
    expect(cellTypes(table)).toEqual([
      ['tableHeader', 'tableHeader'],
      ['tableCell', 'tableCell'],
      ['tableCell', 'tableCell'],
    ]);
    expect(table.child(0).child(1).textContent).toBe('Qty');
    expect(cellTypes(parseTypst(FIXTURES.brackets).child(0))[0]).toEqual(['tableHeader', 'tableHeader']);
  });

  it('keeps headers it cannot model raw: partial rows, arguments, after cells, twice', () => {
    const doc = parseTypst(FIXTURES.notModelled);
    doc.forEach((block) => expect(block.type.name).toBe('rawBlock'));
  });

  it('editing a header cell changes only that cell', () => {
    const doc = edit(parseTypst(FIXTURES.parens), (s) => s.tr.insertText('s', after(s.doc, 'Name')));
    expect(serializeToTypst(doc)).toBe(FIXTURES.parens.replace('[Name]', '[Names]'));
    expectPreciseMap(doc);
  });

  it('turning the header row into a normal row re-prints the table without table.header', () => {
    const doc = setFirstRow(parseTypst(FIXTURES.parens), 'tableCell');
    expect(serializeToTypst(doc)).toBe('#table(\n  columns: 2,\n  [Name], [*Qty*],\n  [a], [1],\n  [b], [2],\n)\n');
    expectPreciseMap(doc);
  });

  it('turning the first row into a header row wraps it in table.header, in the style of the table', () => {
    const doc = setFirstRow(parseTypst('#table(columns: 2, stroke: none, [a], [b], [c], [d])\n'), 'tableHeader');
    expect(serializeToTypst(doc)).toBe('#table(columns: 2, stroke: none, table.header([a], [b]), [c], [d])\n');
    expectPreciseMap(doc);
  });
});
