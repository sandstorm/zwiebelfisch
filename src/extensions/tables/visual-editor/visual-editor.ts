// What the tables extension contributes to the Visual editor. See tables in ../tables.ts.
import { Extension, findParentNode, type Editor } from '@tiptap/core';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { svg, type Anchor, type ChainButton, type FloatingBar, type TypstNodeSpec } from '../../../hosts/visual-editor/visual-editor';
import { tableToTypst } from './table-printing';
import { parseTable } from './table-parser';

/**
 * Tiptap's tables. A table may be a figure's body (`table(..)` in `#figure(..)`), so it joins `figureBody`; a cell
 * holds any blocks, which other constructs may wrap (an alignment block), so cells join `blockContainer`.
 */
const Tables = Extension.create({
  name: 'typstTables',
  addExtensions: () => [
    Table.extend({
      group: 'block figureBody',
      // `sep`: the whitespace to the next block; `layout`: how the call around its cells is written
      addAttributes() {
        return { ...this.parent?.(), sep: { default: null, rendered: false }, layout: { default: null, rendered: false } };
      },
    }).configure({ resizable: false, HTMLAttributes: { class: 'zwf-tables__table' } }),
    TableRow,
    TableCell.extend({ group: 'blockContainer', addAttributes: cellAttributes }),
    TableHeader.extend({ group: 'blockContainer', addAttributes: cellAttributes }),
  ],
});

/**
 * `#table(columns: <int or array>, ..named, cells)` as an editable table: `columns` before the cells, positional
 * arguments that fill whole rows, the first row optionally a `table.header(..)`. Cells hold blocks; a cell written as
 * an expression (`ms(18)`) holds a raw box. Other `table.*` elements, other expressions and comments keep the table raw.
 */
export const TABLE: TypstNodeSpec = {
  name: 'table',
  tiptap: Tables,
  typst: { parseTypst: { calls: { table: { block: parseTable } } }, toTypst: tableToTypst, anchors: ['layout', 'track'], labelled: true },
};

const ICONS = {
  table: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M12 4v16"/>'),
  addRow: svg('<rect x="3" y="4" width="18" height="9" rx="2"/><path d="M12 16v5M9.5 18.5h5"/>'),
  addColumn: svg('<rect x="3" y="3" width="9" height="18" rx="2"/><path d="M15 12h5M17.5 9.5v5"/>'),
  deleteRow: svg('<rect x="3" y="4" width="18" height="9" rx="2"/><path d="M9.5 18.5h5"/>'),
  deleteColumn: svg('<rect x="3" y="3" width="9" height="18" rx="2"/><path d="M15 12h5"/>'),
  headerRow: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M4 7h16" stroke-width="4"/>'),
};

/** "Insert table" in the Insert menu: a 2 × 2 table without header row. */
export const INSERT_TABLE: ChainButton = {
  command: 'tables.insertTable',
  title: 'Insert table',
  icon: ICONS.table,
  keywords: ['grid', 'spreadsheet'],
  order: 20,
  chain: (c) => c.insertTable({ rows: 2, cols: 2, withHeaderRow: false }),
};

/** The bar floating above the table that holds the cursor. */
export const TABLE_BAR: FloatingBar = { id: 'visualEditor/table', order: 20, label: 'Table', anchor: ({ tiptap }) => tableAnchor(tiptap) };

/** The table bar's buttons: rows, columns, header row. */
export const TABLE_EDITS: ChainButton[] = [
  { command: 'tables.addRowAfter', title: 'Add row', icon: ICONS.addRow, order: 10, chain: (c) => c.addRowAfter() },
  { command: 'tables.addColumnAfter', title: 'Add column', icon: ICONS.addColumn, order: 20, chain: (c) => c.addColumnAfter() },
  { command: 'tables.deleteRow', title: 'Delete row', icon: ICONS.deleteRow, order: 30, chain: (c) => c.deleteRow() },
  { command: 'tables.deleteColumn', title: 'Delete column', icon: ICONS.deleteColumn, order: 40, chain: (c) => c.deleteColumn() },
  // makes the first row a `table.header(..)`, or a normal row again
  { command: 'tables.toggleHeaderRow', title: 'Header row', icon: ICONS.headerRow, order: 50, chain: (c) => c.toggleHeaderRow(), toggled: ({ tiptap }) => inHeaderTable(tiptap) },
];

/** A cell's attributes: Tiptap's, and `track`: its column's entry of `columns: (..)` (`2fr`), as written. */
function cellAttributes(this: { parent?: () => Record<string, unknown> }) {
  return { ...this.parent?.(), track: { default: null, rendered: false } };
}

/** Above the table holding the cursor, or null. */
function tableAnchor(editor: Editor): Anchor {
  const table = findParentNode((node) => node.type.name === 'table')(editor.state.selection);
  const dom = table && (editor.view.nodeDOM(table.pos) as HTMLElement | null);
  if (!dom?.getBoundingClientRect) return null;
  const box = dom.getBoundingClientRect();
  return { top: box.top, left: box.left, right: box.left + Math.min(box.width, 320) };
}

/** Whether the selection is in a table whose first row is a header row. */
function inHeaderTable(editor: Editor): boolean {
  const table = findParentNode((node) => node.type.name === 'table')(editor.state.selection);
  const first = table?.node.firstChild;
  return !!first && first.childCount > 0 && first.content.content.every((cell) => cell.type.name === 'tableHeader');
}
