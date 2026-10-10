// Tables: `#table(columns: n, ..)` as Tiptap's table nodes, "Insert table" and the bar over a table. Entry of
// visual-view/builtins/tables/. See ARCHITECTURE.md, "VisualView".
import { Extension, findParentNode, type Editor } from '@tiptap/core';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import type { Anchor } from '../../../ui/floating-bar/floating-bar';
import { svg, type Action, type TypstNodeSpec, type VisualViewContribution } from '../../../hosts/visual-view/visual-view';
import { printTable } from './table-printing';
import { projectTable } from './table-projection';

/**
 * `#table(columns: <int>, ..named, cells)` whose `columns` comes before the
 * cells and whose positional arguments are cells filling whole rows (the
 * first row may be a `table.header(..)` of header cells), as Tiptap's MIT
 * table extensions (not resizable); cells hold blocks, segmented like the
 * document. A cell written as an expression (`ms(18)`) holds one paragraph
 * with one raw inline box whose `code` attribute is set. Other `table.*`
 * elements, other expressions and comments keep the table raw. `layout` is the
 * source around the cells and how its rows are written (see `table-layout.ts`).
 * Also "Insert table" and the bar above a table holding the cursor (rows,
 * columns, header row).
 */
export const tables: VisualViewContribution = {
  id: 'tables',
  activate({ visualView, subscriptions }) {
    subscriptions.push(
      visualView.registerNode(TABLE),
      visualView.registerToolbarItem({ group: 'insert', order: 20, action: INSERT_TABLE }),
      visualView.registerToolbarGroup({ kind: 'floating', id: 'table', order: 20, label: 'Table', anchor: (editor) => tableAnchor(editor) }),
      ...TABLE_EDITS.map((action, i) => visualView.registerToolbarItem({ group: 'table', order: 10 * (i + 1), action })),
    );
  },
};

const Tables = Extension.create({
  name: 'typstTables',
  addExtensions: () => [Table.configure({ resizable: false, HTMLAttributes: { class: 'typst-visual__table' } }), TableRow, TableCell, TableHeader],
});

const TABLE: TypstNodeSpec = {
  name: 'table',
  extension: Tables,
  attributes: { sep: { default: null, rendered: false }, layout: { default: null, rendered: false } },
  anchors: ['layout'],
  labelled: true,
  blockCalls: { table: projectTable },
  print: printTable,
};

const ICONS = {
  table: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M12 4v16"/>'),
  addRow: svg('<rect x="3" y="4" width="18" height="9" rx="2"/><path d="M12 16v5M9.5 18.5h5"/>'),
  addColumn: svg('<rect x="3" y="3" width="9" height="18" rx="2"/><path d="M15 12h5M17.5 9.5v5"/>'),
  deleteRow: svg('<rect x="3" y="4" width="18" height="9" rx="2"/><path d="M9.5 18.5h5"/>'),
  deleteColumn: svg('<rect x="3" y="3" width="9" height="18" rx="2"/><path d="M15 12h5"/>'),
  headerRow: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M4 7h16" stroke-width="4"/>'),
};

const INSERT_TABLE: Action = { label: 'Insert table', icon: ICONS.table, run: (c) => c.insertTable({ rows: 2, cols: 2, withHeaderRow: false }) };

/** The bar over a table the cursor is in. */
const TABLE_EDITS: Action[] = [
  { label: 'Add row', icon: ICONS.addRow, run: (c) => c.addRowAfter() },
  { label: 'Add column', icon: ICONS.addColumn, run: (c) => c.addColumnAfter() },
  { label: 'Delete row', icon: ICONS.deleteRow, run: (c) => c.deleteRow() },
  { label: 'Delete column', icon: ICONS.deleteColumn, run: (c) => c.deleteColumn() },
  // makes the first row a `table.header(..)`, or a normal row again
  { label: 'Header row', icon: ICONS.headerRow, run: (c) => c.toggleHeaderRow(), active: inHeaderTable },
];

/** Whether the selection is in a table whose first row is a header row. */
function inHeaderTable(editor: Editor): boolean {
  const table = findParentNode((node) => node.type.name === 'table')(editor.state.selection);
  const first = table?.node.firstChild;
  return !!first && first.childCount > 0 && first.content.content.every((cell) => cell.type.name === 'tableHeader');
}

/** Above the table holding the cursor, or null. */
function tableAnchor(editor: Editor): Anchor {
  const table = findParentNode((node) => node.type.name === 'table')(editor.state.selection);
  const dom = table && (editor.view.nodeDOM(table.pos) as HTMLElement | null);
  if (!dom?.getBoundingClientRect) return null;
  const box = dom.getBoundingClientRect();
  return { top: box.top, left: box.left, right: box.left + Math.min(box.width, 320) };
}
