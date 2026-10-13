// Tests for tables whose `columns` is an array of track sizes (`(auto, 1fr)`), through the Typst ↔ ProseMirror conversion.
import { readFileSync } from 'node:fs';
import type { Node } from '@tiptap/pm/model';
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state';
import { addColumnAfter, addColumnBefore, addRowAfter, deleteColumn } from '@tiptap/pm/tables';
import { describe, expect, it } from 'vitest';
import { serializeToTypst, applyTypstChanges } from '../../../hosts/prosemirror-typst/prosemirror-typst';
import { after, edit, expectPreciseMap, find, parseTypst } from '../../../testing/testing';

const FIXTURES: Record<string, string> = {
  mixed: '#table(\n  columns: (auto, 2fr, 1fr),\n  table.header[A][B][C],\n  [a], [b], [c],\n)\n',
  fractions: '#table(columns: (1fr, 1fr), [a], [b])\n',
  single: '#table(columns: (1fr,), [a], [b])\n',
  trailingComma: '#table(columns: (auto, 3cm,), [a], [b])\n',
  expressions: '#table(columns: (30%, 1fr + 2pt, calc.max(1cm, 2cm)), [a], [b], [c])\n',
  multiLine: '#table(\n  columns: (\n    auto,\n    1fr,\n  ),\n  [a], [b],\n)\n',
  irregular: '#table(columns: ( auto,1fr ,  2fr ), [a], [b], [c])\n',
};

const RAW = [
  '#table(columns: cols, [a])',
  '#table(columns: f(2), [a])',
  '#table(columns: 1 + 1, [a], [b])',
  '#table(columns: (auto), [a])',
  '#table(columns: (), [a])',
  '#table(columns: (..xs, 1fr), [a], [b])',
  '#table(columns: (auto, // c\n 1fr), [a], [b])',
  '#table(columns: (a: 1fr), [a])',
  '#table(columns: (auto, 1fr), [a], [b], [c])',
];

/** Runs a table command with the cursor right after `text`. */
function command(doc: Node, text: string, run: Command): Node {
  const state = EditorState.create({ doc });
  const at = state.apply(state.tr.setSelection(TextSelection.create(doc, after(doc, text))));
  let next: Node | null = null;
  run(at, (tr) => (next = at.apply(tr).doc));
  if (!next) throw new Error('command did not apply');
  return next;
}

describe('track-size columns', () => {
  describe('round-trip byte for byte, with a precise position map', () => {
    for (const [name, source] of Object.entries(FIXTURES)) {
      it(name, () => {
        const doc = parseTypst(source);
        expect(doc.child(0).type.name).toBe('table');
        expect(serializeToTypst(doc)).toBe(source);
        expectPreciseMap(doc);
      });
    }
  });

  it('a column per entry; other `columns` values, spreads, comments and partial rows stay raw', () => {
    const table = parseTypst(FIXTURES.mixed).child(0);
    expect(table.childCount).toBe(2);
    expect(table.child(0).childCount).toBe(3);
    expect(table.child(1).child(1).attrs.track).toBe('2fr');
    for (const src of RAW) expect(parseTypst(src).child(0).type.name, src).toBe('rawBlock');
  });

  it('editing a cell changes only it', () => {
    const doc = edit(parseTypst(FIXTURES.mixed), (s) => s.tr.insertText('!', after(s.doc, 'b')));
    expect(serializeToTypst(doc)).toBe(FIXTURES.mixed.replace('[b]', '[b!]'));
    expectPreciseMap(doc);
  });

  it('adding a row keeps the array as written', () => {
    const doc = command(parseTypst(FIXTURES.irregular), 'c', addRowAfter);
    expect(serializeToTypst(doc)).toBe('#table(columns: ( auto,1fr ,  2fr ), [a], [b], [c], [], [], [])\n');
  });

  describe('adding and deleting columns', () => {
    it('adds an entry at the column: auto among other sizes', () => {
      const doc = command(parseTypst(FIXTURES.mixed), 'a', addColumnAfter);
      expect(serializeToTypst(doc)).toBe('#table(\n  columns: (auto, auto, 2fr, 1fr),\n  table.header[A][][B][C],\n  [a], [], [b], [c],\n)\n');
      expectPreciseMap(doc);
      const before = command(parseTypst(FIXTURES.mixed), 'c', addColumnBefore);
      expect(serializeToTypst(before)).toContain('columns: (auto, 2fr, auto, 1fr),');
    });

    it('adds 1fr among fractions only', () => {
      const doc = command(parseTypst(FIXTURES.fractions), 'b', addColumnAfter);
      expect(serializeToTypst(doc)).toBe('#table(columns: (1fr, 1fr, 1fr), [a], [b], [])\n');
    });

    it('deletes the entry of the deleted column', () => {
      const doc = command(parseTypst(FIXTURES.mixed), 'B', deleteColumn);
      expect(serializeToTypst(doc)).toBe('#table(\n  columns: (auto, 1fr),\n  table.header[A][C],\n  [a], [c],\n)\n');
      expectPreciseMap(doc);
    });

    it('a deleted and an added column change the entries, though not their count', () => {
      const doc = command(command(parseTypst(FIXTURES.mixed), 'A', deleteColumn), 'c', addColumnAfter);
      expect(serializeToTypst(doc)).toBe('#table(\n  columns: (2fr, 1fr, 1fr),\n  table.header[B][C][],\n  [b], [c], [],\n)\n');
    });

    it('separators follow the array: trailing comma, line breaks, expressions', () => {
      const comma = command(parseTypst(FIXTURES.trailingComma), 'a', addColumnAfter);
      expect(serializeToTypst(comma)).toBe('#table(columns: (auto, auto, 3cm,), [a], [], [b])\n');
      const lines = command(parseTypst(FIXTURES.multiLine), 'a', deleteColumn);
      expect(serializeToTypst(lines)).toBe('#table(\n  columns: (\n    1fr,\n  ),\n  [b],\n)\n');
      const expressions = command(parseTypst(FIXTURES.expressions), 'a', deleteColumn);
      expect(serializeToTypst(expressions)).toBe('#table(columns: (1fr + 2pt, calc.max(1cm, 2cm)), [b], [c])\n');
    });

    it('a single entry keeps the comma that makes it an array', () => {
      const one = command(parseTypst(FIXTURES.mixed.replace('(auto, 2fr, 1fr)', '(auto, 1fr)').replace('[C]', '').replace(', [c]', '')), 'A', deleteColumn);
      expect(serializeToTypst(one)).toBe('#table(\n  columns: (1fr,),\n  table.header[B],\n  [b],\n)\n');
      const two = command(parseTypst(FIXTURES.single), 'a', addColumnAfter);
      expect(serializeToTypst(two)).toBe('#table(columns: (1fr, 1fr), [a], [], [b], [])\n');
      expect(serializeToTypst(command(two, 'a', deleteColumn))).toBe('#table(columns: (1fr,), [], [])\n');
    });
  });

  it('an outside change to an entry updates the cells in place', () => {
    const state = EditorState.create({ doc: parseTypst(FIXTURES.mixed) });
    const changed = FIXTURES.mixed.replace('2fr', '3fr');
    const tr = applyTypstChanges(state.tr, parseTypst(changed));
    expect(serializeToTypst(tr.doc)).toBe(changed);
    expect(tr.doc.child(0).child(1).child(1).attrs.track).toBe('3fr');
    const added = command(tr.doc, 'a', addColumnAfter);
    expect(serializeToTypst(added)).toContain('columns: (auto, auto, 3fr, 1fr),');
  });

  describe('the extension list of the architecture docs', () => {
    const docs = readFileSync(new URL('../../../../docs/40_architecture/08_extensions.typ', import.meta.url), 'utf8');

    it('is an editable table that round-trips', () => {
      const doc = parseTypst(docs);
      expect(serializeToTypst(doc)).toBe(docs);
      expectPreciseMap(doc);
      const { node } = find(doc, 'table');
      expect(node.child(0).child(0).type.name).toBe('tableHeader');
      expect(node.child(0).textContent).toBe('ExtensionWhat it addsThrough');
      expect(node.childCount).toBeGreaterThan(20);
    });

    it('editing a cell changes only that cell', () => {
      const doc = edit(parseTypst(docs), (s) => s.tr.insertText('!', after(s.doc, 'bulleted, numbered and task lists')));
      expect(serializeToTypst(doc)).toBe(docs.replace('[bulleted, numbered and task lists]', '[bulleted, numbered and task lists!]'));
    });
  });
});
