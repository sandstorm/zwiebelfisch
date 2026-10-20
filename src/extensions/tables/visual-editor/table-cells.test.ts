// Tests for real-world tables in the Typst ↔ ProseMirror conversion (visual-editor.ts): expression cells, styles, tables in figures.
import { readFileSync } from 'node:fs';
import type { Node } from '@tiptap/pm/model';
import { EditorState, TextSelection, type Command } from '@tiptap/pm/state';
import { addRowAfter, deleteColumn, deleteRow, toggleHeaderRow } from '@tiptap/pm/tables';
import { describe, expect, it } from 'vitest';
import { serializeToTypst, applyTypstChanges } from '../../../hosts/visual-editor/typst-conversion/typst-conversion';
import { after, edit, expectPreciseMap, find, parseTypst } from '../../../testing/testing';

/** The table of demo/examples/advanced (results.typ), without the figure around it. */
const ADVANCED =
  '#table(\n' +
  '    columns: 4,\n' +
  '    align: (left, right, right, right),\n' +
  '    stroke: (x, y) => if y == 0 { (bottom: 0.7pt) },\n' +
  '    table.header([*Pages*], [*Cold*], [*Incremental*], [*Speed-up*]),\n' +
  '    [1], ms(18), ms(4), [4.5×],\n' +
  '    [10], ms(95), ms(6), [15.8×],\n' +
  '  )\n';

const FIXTURES: Record<string, string> = {
  advanced: ADVANCED,
  oneLine: '#table(columns: 3, [a], ms(1), $x^2$, "s", 1pt, x.y)\n',
  noTrailingComma: '#table(\n  columns: 2,\n  [a], f(1),\n  [b], f(2)\n)\n',
  expressionHeader: '#table(\n  columns: 2,\n  table.header(strong("Name"), [Qty]),\n  [a], str(1),\n)\n',
  multiLineNamed:
    '#table(\n  columns: 2,\n  fill: (x, y) => {\n    if y == 0 { gray }\n  },\n  inset: (x: 4pt, y: 2pt),\n  gutter: 2pt,\n  [a], [b],\n)\n',
  emptyAndSpaced: '#table(columns: 2, [ a ], [],\n  calc.max(1, 2),   [x])\n',
  figure: '#figure(\n  table(\n    columns: 2,\n    [a], ms(1),\n  ),\n  caption: [Times],\n) <tab:t>\n',
  figureNoCaption: '#figure(table(columns: 1, [a]), placement: top)\n',
};

const RAW = [
  '#table(columns: 2, table.cell(colspan: 2)[a], [b], [c])',
  '#table(columns: 1, [a], table.hline(), [b])',
  '#table(columns: 1, [a], table.footer([b]))',
  '#table(columns: 1, [a], -1)',
  '#table(columns: 1, [a], a + b)',
  '#table(columns: 1, [a], // note\n [b])',
  '#table(columns: 1, [a], ..xs)',
  '#table([a], columns: 1)',
  '#figure(table(columns: 1, table.hline(), [a]), caption: [c])',
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

/** The position of the code box showing `src`. */
function box(doc: Node, src: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === 'rawInline' && node.attrs.src === src) found = pos;
  });
  if (found < 0) throw new Error(`no box ${src}`);
  return found;
}

describe('real-world tables', () => {
  describe('round-trip byte for byte, with a precise position map', () => {
    for (const [name, source] of Object.entries(FIXTURES)) {
      it(name, () => {
        const doc = parseTypst(source);
        expect(doc.child(0).type.name).not.toBe('rawBlock');
        expect(serializeToTypst(doc)).toBe(source);
        expectPreciseMap(doc);
      });
    }
  });

  it('parses expression cells as code boxes in cells of their own, header cells too', () => {
    const table = parseTypst(ADVANCED).child(0);
    expect(table.type.name).toBe('table');
    expect(table.childCount).toBe(3);
    expect(table.child(0).child(0).type.name).toBe('tableHeader');
    const cell = table.child(1).child(1);
    expect(cell.type.name).toBe('tableCell');
    expect(cell.child(0).type.name).toBe('paragraph');
    expect(cell.child(0).child(0).type.name).toBe('rawInline');
    expect(cell.child(0).child(0).attrs).toEqual({ src: 'ms(18)', code: true });
    const header = parseTypst(FIXTURES.expressionHeader).child(0).child(0);
    expect(header.child(0).type.name).toBe('tableHeader');
    expect(header.child(0).child(0).child(0).attrs.src).toBe('strong("Name")');
  });

  it('keeps tables it cannot model raw: spans, lines, footers, other expressions, comments', () => {
    for (const src of RAW) expect(parseTypst(src).child(0).type.name, src).toBe('rawBlock');
  });

  describe('editing', () => {
    it("editing an expression cell's code changes only that code", () => {
      const doc = edit(parseTypst(ADVANCED), (s) => s.tr.setNodeAttribute(box(s.doc, 'ms(18)'), 'src', 'ms(19)'));
      expect(serializeToTypst(doc)).toBe(ADVANCED.replace('ms(18)', 'ms(19)'));
      expectPreciseMap(doc);
    });

    it('code that is no longer one expression becomes content: [#..]', () => {
      const doc = edit(parseTypst(ADVANCED), (s) => s.tr.setNodeAttribute(box(s.doc, 'ms(18)'), 'src', 'ms(18) + 1'));
      expect(serializeToTypst(doc)).toBe(ADVANCED.replace('ms(18)', '[#ms(18) + 1]'));
    });

    it('typing next to the box makes the cell content: [#ms(18) more]', () => {
      const doc = edit(parseTypst(ADVANCED), (s) => s.tr.insertText(' more', box(s.doc, 'ms(18)') + 1));
      expect(serializeToTypst(doc)).toBe(ADVANCED.replace('ms(18)', '[#ms(18) more]'));
      expectPreciseMap(doc);
      const before = edit(parseTypst(ADVANCED), (s) => s.tr.insertText('ca. ', box(s.doc, 'ms(4)')));
      expect(serializeToTypst(before)).toBe(ADVANCED.replace('ms(4)', '[ca. #ms(4)]'));
    });

    it('a math cell prints as it is, in markup too', () => {
      const doc = edit(parseTypst(FIXTURES.oneLine), (s) => s.tr.insertText('!', box(s.doc, '$x^2$') + 1));
      expect(serializeToTypst(doc)).toBe(FIXTURES.oneLine.replace('$x^2$', '[$x^2$!]'));
    });

    it('clearing an expression cell leaves []', () => {
      const doc = edit(parseTypst(ADVANCED), (s) => {
        const pos = box(s.doc, 'ms(18)');
        return s.tr.delete(pos, pos + 1);
      });
      expect(serializeToTypst(doc)).toBe(ADVANCED.replace('ms(18)', '[]'));
      expectPreciseMap(doc);
    });

    it('syncs an outside change to an expression as a change of that box only', () => {
      const state = EditorState.create({ doc: parseTypst(ADVANCED) });
      const changed = ADVANCED.replace('ms(18)', 'ms(19)');
      const tr = applyTypstChanges(state.tr, parseTypst(changed));
      expect(serializeToTypst(tr.doc)).toBe(changed);
      expect(tr.doc.child(0).child(2)).toBe(state.doc.child(0).child(2));
      // only the box itself is replaced (a leaf's new `src`)
      const box = state.doc.child(0).child(1).child(1).child(0).child(0);
      expect(tr.steps.length).toBeGreaterThan(0);
      tr.steps.forEach((step) => step.getMap().forEach((from, to) => expect(to - from).toBeLessThanOrEqual(box.nodeSize)));
      expectPreciseMap(tr.doc);
    });

    it('editing a content cell next to expression cells changes only that cell', () => {
      const doc = edit(parseTypst(ADVANCED), (s) => s.tr.insertText('0', after(s.doc, '4.5')));
      expect(serializeToTypst(doc)).toBe(ADVANCED.replace('[4.5×]', '[4.50×]'));
      expectPreciseMap(doc);
    });
  });

  describe('changing the shape keeps the style', () => {
    it('adding a row: indentation, separators and the closing stay as written', () => {
      const doc = command(parseTypst(ADVANCED), '15.8', addRowAfter);
      expect(serializeToTypst(doc)).toBe(ADVANCED.replace('[15.8×],\n', '[15.8×],\n    [], [], [], [],\n'));
      expectPreciseMap(doc);
    });

    it('deleting a row and a column', () => {
      const withoutRow = command(parseTypst(ADVANCED), '15.8', deleteRow);
      expect(serializeToTypst(withoutRow)).toBe(ADVANCED.replace('    [10], ms(95), ms(6), [15.8×],\n', ''));
      const withoutColumn = command(parseTypst(ADVANCED), 'Speed-up', deleteColumn);
      expect(serializeToTypst(withoutColumn)).toBe(
        ADVANCED.replace('columns: 4', 'columns: 3')
          .replace(', [*Speed-up*]', '')
          .replace(', [4.5×]', '')
          .replace(', [15.8×]', ''),
      );
      expectPreciseMap(withoutColumn);
    });

    it('a one-line table stays on one line', () => {
      const doc = command(parseTypst(FIXTURES.oneLine), 'a', addRowAfter);
      expect(serializeToTypst(doc)).toBe('#table(columns: 3, [a], ms(1), $x^2$, [], [], [], "s", 1pt, x.y)\n');
    });

    it('toggling the header row off and on with expression cells', () => {
      const plain = command(parseTypst(FIXTURES.expressionHeader), 'Qty', toggleHeaderRow);
      expect(serializeToTypst(plain)).toBe('#table(\n  columns: 2,\n  strong("Name"), [Qty],\n  [a], str(1),\n)\n');
      expectPreciseMap(plain);
      const header = command(parseTypst(FIXTURES.advanced.replace('table.header(', '').replace('[*Speed-up*]),', '[*Speed-up*],')), 'Cold', toggleHeaderRow);
      expect(serializeToTypst(header)).toBe(ADVANCED);
      const again = command(plain, 'Qty', toggleHeaderRow);
      expect(serializeToTypst(again)).toBe(FIXTURES.expressionHeader);
    });

    it('a bracket-form header falls back to table.header(..) when it holds an expression', () => {
      const source = '#table(columns: 2, table.header[A][B], [a], [b], [c], ms(1))\n';
      const kept = command(command(parseTypst(source), 'b', deleteRow), 'B', toggleHeaderRow);
      expect(serializeToTypst(kept)).toBe('#table(columns: 2, [A], [B], [c], ms(1))\n');
      const doc = command(command(command(parseTypst(source), 'b', deleteRow), 'A', deleteRow), 'c', toggleHeaderRow);
      expect(serializeToTypst(doc)).toBe('#table(columns: 2, table.header([c], ms(1)))\n');
      const brackets = command(command(parseTypst(source), 'b', deleteRow), 'c', deleteRow);
      expect(serializeToTypst(brackets)).toBe('#table(columns: 2, table.header[A][B])\n');
    });

    it('named arguments between rows survive a re-print, after the head', () => {
      const source = '#table(columns: 1, [a], stroke: none, [b])\n';
      const doc = command(parseTypst(source), 'b', addRowAfter);
      expect(serializeToTypst(doc)).toBe('#table(columns: 1, stroke: none, [a], [b], [])\n');
    });
  });

  describe('tables in figures', () => {
    it('parses the table as the figure body, the caption as rich text', () => {
      const figure = parseTypst(FIXTURES.figure).child(0);
      expect(figure.type.name).toBe('figure');
      expect(figure.child(0).type.name).toBe('table');
      expect(figure.child(1).textContent).toBe('Times');
    });

    it('editing the caption or a cell changes only that', () => {
      const caption = edit(parseTypst(FIXTURES.figure), (s) => s.tr.insertText(' (ms)', after(s.doc, 'Times')));
      expect(serializeToTypst(caption)).toBe(FIXTURES.figure.replace('[Times]', '[Times (ms)]'));
      expectPreciseMap(caption);
      const cell = edit(parseTypst(FIXTURES.figure), (s) => s.tr.setNodeAttribute(box(s.doc, 'ms(1)'), 'src', 'ms(2)'));
      expect(serializeToTypst(cell)).toBe(FIXTURES.figure.replace('ms(1)', 'ms(2)'));
    });

    it('adding a row re-prints just the table, in its style, inside the figure', () => {
      const doc = command(parseTypst(FIXTURES.figure), 'a', addRowAfter);
      expect(serializeToTypst(doc)).toBe(FIXTURES.figure.replace('[a], ms(1),\n', '[a], ms(1),\n    [], [],\n'));
      expectPreciseMap(doc);
    });
  });

  describe('the advanced demo example', () => {
    const results = readFileSync(new URL('../../../../demo/examples/advanced/chapters/results.typ', import.meta.url), 'utf8');

    it('round-trips, its timings table a figure with a table and an editable caption', () => {
      const doc = parseTypst(results);
      expect(serializeToTypst(doc)).toBe(results);
      expectPreciseMap(doc);
      const { node } = find(doc, 'figure');
      expect(node.child(0).type.name).toBe('table');
      expect(node.child(1).textContent).toBe('Median compile times (illustrative numbers).');
    });

    it('editing a timing changes only that number', () => {
      const doc = edit(parseTypst(results), (s) => s.tr.setNodeAttribute(box(s.doc, 'ms(820)'), 'src', 'ms(830)'));
      expect(serializeToTypst(doc)).toBe(results.replace('ms(820)', 'ms(830)'));
    });

    it('adding a row keeps the 4-space indentation', () => {
      const doc = command(parseTypst(results), '68.3', addRowAfter);
      expect(serializeToTypst(doc)).toBe(results.replace('[68.3×],\n', '[68.3×],\n    [], [], [], [],\n'));
    });
  });
});
