import type { Extension } from '../../hosts/workbench/workbench';
import css from './block-gaps.css?inline';
import { BlockGaps } from './visual-editor/block-gaps';

/**
 * A caret between blocks in the Visual editor, as CKEditor 5 offers beside its widgets: before or after a box (a block
 * style, figure, table, raw box or code block), where arrow keys stop and typing starts a paragraph.
 *
 * Without this extension the caret is ProseMirror's own: beside a box it goes into the text nearest.
 */
export function blockGaps(): Extension {
  return {
    id: 'block-gaps',
    activate({ window, visualEditor, subscriptions }) {
      subscriptions.push(window.registerStyleSheet(css), visualEditor.registerTiptapExtension(BlockGaps));
    },
  };
}
