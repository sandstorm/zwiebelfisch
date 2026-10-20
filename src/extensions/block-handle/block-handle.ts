import type { Extension } from '../../hosts/workbench/workbench';
import css from './block-handle.css?inline';
import { BlockHandle } from './visual-editor/grip';

/**
 * Moving blocks with the pointer in the Visual editor, as in Notion: a grip (six dots) in the left margin beside the
 * block under the pointer (a top-level block or a list item, at any depth), dragged to move the block, clicked to
 * select it; and the drop cursor, the line where a dragged block or file lands.
 *
 * A move is one undo step and keeps the block's Typst verbatim. Without this extension blocks still move by dragging a
 * selected node, only without the grip and the line.
 */
export function blockHandle(): Extension {
  return {
    id: 'block-handle',
    activate({ window, visualEditor, subscriptions }) {
      subscriptions.push(window.registerStyleSheet(css), visualEditor.registerTiptapExtension(BlockHandle));
    },
  };
}
