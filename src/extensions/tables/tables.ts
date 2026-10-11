// The tables extension: `#table(columns: n, ..)` in the Visual editor as an editable table, with "Insert table" and a
// bar over the table holding the cursor (rows, columns, header row). See docs/30_architecture/08_built-in-extensions.typ. Why an
// extension: the Visual editor's host models only paragraphs, text and raw Typst; a table the view cannot model stays a
// raw box.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './tables.css?inline';
import { INSERT_TABLE, TABLE, TABLE_BAR, TABLE_EDITS } from './visual-editor/visual-editor';

/** Tables, "Insert table" and the table bar. */
export function tables(): TypstExtension {
  return {
    id: 'tables',
    activate({ workbench, visualEditor, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      subscriptions.push(
        visualEditor.registerNode(TABLE),
        visualEditor.registerToolbarItem({ group: 'insert', order: 20, action: INSERT_TABLE }),
        visualEditor.registerToolbarGroup(TABLE_BAR),
        ...TABLE_EDITS.map((action, i) => visualEditor.registerToolbarItem({ group: 'table', order: 10 * (i + 1), action })),
      );
    },
  };
}
