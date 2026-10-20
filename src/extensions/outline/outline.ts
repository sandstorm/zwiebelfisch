import { registerChainButton } from '../../hosts/visual-editor/visual-editor';
import type { Extension } from '../../hosts/workbench/workbench';
import { INSERT_OUTLINE, OUTLINE } from './visual-editor/visual-editor';

/**
 * The table of contents in the Visual editor: a standalone `#outline(..)` as a box headed "Table of contents", and
 * Insert → "Table of contents".
 *
 * The box keeps the call's source as written and edits it like any raw box.
 */
export function outline(): Extension {
  return {
    id: 'outline',
    activate(context) {
      context.subscriptions.push(context.visualEditor.registerNode(OUTLINE), registerChainButton(context, 'visualEditor/insert', INSERT_OUTLINE));
    },
  };
}
