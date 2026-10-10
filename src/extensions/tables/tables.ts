// The tables extension: `#table(columns: n, ..)` in the Visual view as an editable table, with "Insert table" and a
// bar over the table holding the cursor (rows, columns, header row). See ARCHITECTURE.md, "VisualView". Why an
// extension: the Visual view's host models only paragraphs, text and raw Typst; a table the view cannot model stays a
// raw box.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { INSERT_TABLE, TABLE, TABLE_BAR, TABLE_EDITS } from './visual-view/visual-view';

/** Tables, "Insert table" and the table bar. */
export const tables: TypstExtension = {
  id: 'tables',
  activate({ visualView, subscriptions }) {
    subscriptions.push(
      visualView.registerNode(TABLE),
      visualView.registerToolbarItem({ group: 'insert', order: 20, action: INSERT_TABLE }),
      visualView.registerToolbarGroup(TABLE_BAR),
      ...TABLE_EDITS.map((action, i) => visualView.registerToolbarItem({ group: 'table', order: 10 * (i + 1), action })),
    );
  },
};
