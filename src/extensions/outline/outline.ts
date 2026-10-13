import type { TypstExtension } from '../../hosts/workbench/workbench';
import { INSERT_OUTLINE, OUTLINE } from './visual-editor/visual-editor';

/**
 * The table of contents in the Visual editor: a standalone `#outline(..)` as a box headed "Table of contents", and
 * Insert → "Table of contents".
 *
 * The box keeps the call's source and edits it like any raw box. Where a box renderer draws pictures (the
 * rendered-boxes extension), it shows the compiled outline.
 * See docs/20_features/03_writing.typ.
 */
export function outline(): TypstExtension {
  return {
    id: 'outline',
    activate({ visualEditor, subscriptions }) {
      subscriptions.push(visualEditor.registerNode(OUTLINE), visualEditor.registerToolbarItem({ group: 'insert', order: 30, action: INSERT_OUTLINE }));
    },
  };
}
