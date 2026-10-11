// Tests for visual-view.ts: list items with nested lists and further blocks are editable lists, printed back byte for
// byte while untouched and indented as written after an edit.
import { describe, expect, it } from 'vitest';
import type { Node } from '@tiptap/pm/model';
import { serializeToTypst } from '../../../hosts/prosemirror-typst/prosemirror-typst';
import { after, edit, expectPreciseMap, parseTypst } from '../../../testing/testing';

/** The list of docs/guide/features.typ's Spreadsheets section, which showed as a raw box. */
const SPREADSHEETS = `- File panel → New → "New spreadsheet…" creates an \`.ic\` file and opens it in #link("https://www.ironcalc.com")[IronCalc]: formulas, formats, several sheets.
- Insert → Insert spreadsheet (or \`/spreadsheet\`): names a new \`.ic\` (proposed: \`data/table.ic\` next to the file), fills in a starter table, inserts \`#figure(sheets.Sheet1, caption: [ ])\` with its import and opens the spreadsheet. If \`sheets\` already names another spreadsheet's tables, the new one is imported as \`table-sheets\`.
- Every edit also writes \`<name>.ic.gen.typ\` (generated; don't edit). It holds, by sheet name:
  - \`sheets\`: each sheet as a \`table\` that looks like the spreadsheet (column widths, fills, fonts, borders).
  - \`values\`: the displayed cells as strings, row by row: \`values.Runs.at(1).at(0)\` is A2.
- The preview follows every edit of the spreadsheet.
- Not supported: merged cells, \`.xlsx\` files.
`;

/** The node types in `doc`, depth first. */
function types(doc: Node): string[] {
  const names: string[] = [];
  doc.descendants((node) => void names.push(node.type.name));
  return names;
}

describe('nested lists', () => {
  it('reads an item with a nested list as a paragraph and a list, and prints it back byte for byte', () => {
    const doc = parseTypst(SPREADSHEETS);
    expect(types(doc)).not.toContain('rawBlock');
    const item = doc.child(0).child(2);
    expect([item.child(0).type.name, item.child(1).type.name]).toEqual(['paragraph', 'bulletList']);
    expect(item.child(1).child(1).textContent).toBe('values: the displayed cells as strings, row by row: values.Runs.at(1).at(0) is A2.');
    expect(serializeToTypst(doc)).toBe(SPREADSHEETS);
    expectPreciseMap(doc);
  });

  it('keeps any indentation, paragraphs in an item and enum items as written', () => {
    const source = '1.  first\n    continued\n\n    second paragraph\n    + nested\n       deeper\n2. next\n';
    const doc = parseTypst(source);
    expect(types(doc)).not.toContain('rawBlock');
    expect(doc.child(0).child(0).childCount).toBe(3);
    expect(serializeToTypst(doc)).toBe(source);
    expectPreciseMap(doc);
  });

  it('typing in a nested item keeps its siblings and the outer item as indented', () => {
    const source = '- outer:\n   - a\n   - b\n     - c\n- next\n';
    const typed = edit(parseTypst(source), (s) => s.tr.insertText('!', after(s.doc, 'b')));
    expect(serializeToTypst(typed)).toBe('- outer:\n   - a\n   - b!\n     - c\n- next\n');
    expectPreciseMap(typed);
  });

  it('nests deeper levels under an item read from the source', () => {
    const doc = edit(parseTypst('- a\n  - b\n'), (s) => {
      const { bulletList, listItem, paragraph } = s.schema.nodes;
      const deep = bulletList.create(null, [listItem.create(null, paragraph.create(null, s.schema.text('c')))]);
      return s.tr.insert(after(s.doc, 'b') + 1, deep);
    });
    expect(serializeToTypst(doc)).toBe('- a\n  - b\n    - c\n');
    expectPreciseMap(doc);
  });

  it('keeps an item whose body starts with a heading, and a task with more than a paragraph, raw', () => {
    for (const source of ['- = Title\n  text\n', '- [ ] task\n\n  more\n']) {
      const doc = parseTypst(source);
      expect(doc.child(0).child(0).child(0).type.name).toBe('rawBlock');
      expect(serializeToTypst(doc)).toBe(source);
    }
  });

  it('prints an empty item without a space after its marker', () => {
    expect(serializeToTypst(parseTypst('- a\n-\n- b\n'))).toBe('- a\n-\n- b\n');
  });
});
