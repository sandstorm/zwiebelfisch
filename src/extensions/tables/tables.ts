import { registerChainButton } from '../../hosts/visual-editor/visual-editor';
import type { Extension } from '../../hosts/workbench/workbench';
import css from './tables.css?inline';
import { INSERT_TABLE, TABLE, TABLE_BAR, TABLE_EDITS } from './visual-editor/visual-editor';

/**
 * Tables in the Visual editor: `#table(columns: n, ..)` as an editable table, "Insert table" and a bar over the table
 * holding the cursor (rows, columns, header row).
 *
 * Editing a cell changes only that cell's source; a table whose shape changed is printed again in the style it was
 * written in. A table that cannot be edited as a grid (merged cells, lines, a footer, a computed `columns`) stays a
 * raw box.
 */
export function tables(): Extension {
  return {
    id: 'tables',
    activate(context) {
      const { window, visualEditor, subscriptions } = context;
      subscriptions.push(window.registerStyleSheet(css));
      subscriptions.push(
        visualEditor.registerNode(TABLE),
        registerChainButton(context, 'visualEditor/insert', INSERT_TABLE),
        visualEditor.registerFloatingBar(TABLE_BAR),
        ...TABLE_EDITS.map((button) => registerChainButton(context, TABLE_BAR.id, button)),
      );
    },
  };
}
