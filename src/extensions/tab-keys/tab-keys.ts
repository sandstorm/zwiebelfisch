import type { Extension } from '../../hosts/workbench/workbench';
import { TabKeys } from './visual-editor/tab-keys';

/**
 * Tab and Shift+Tab in the Visual editor stay in the text: in code they indent and outdent the selected lines (before
 * the lists' and tables' keymaps), elsewhere the constructs take them and the rest is consumed. Escape, then Tab moves
 * the focus on, as in CodeMirror.
 *
 * Without this extension the editor has ProseMirror's default: Tab not taken by a construct moves the focus.
 */
export function tabKeys(): Extension {
  return {
    id: 'tab-keys',
    activate({ visualEditor, subscriptions }) {
      subscriptions.push(visualEditor.registerTiptapExtension(() => TabKeys));
    },
  };
}
