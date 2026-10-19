import type { Extension } from '../../hosts/workbench/workbench';
import { ALIGN_MENU, ALIGNMENT, ALIGNMENTS, JUSTIFIED_PARAGRAPH } from './visual-editor/visual-editor';

/**
 * Text alignment in the Visual editor: `#align(..)[..]` blocks and `#par(justify: ..)[..]` around one paragraph.
 *
 * Adds to the Visual editor:
 * - the `alignment` node and a `justify` flag on paragraphs
 * - the Align menu and the shortcuts Mod-Shift-L/E/R/J
 *
 * `#set align(..)`, `#set par(justify: ..)` and an `#align` with anything but a literal alignment stay raw Typst.
 */
export function alignment(): Extension {
  return {
    id: 'alignment',
    activate({ visualEditor, subscriptions }) {
      subscriptions.push(
        visualEditor.registerNode(ALIGNMENT),
        visualEditor.registerNode(JUSTIFIED_PARAGRAPH),
        visualEditor.registerToolbarGroup(ALIGN_MENU),
        ...ALIGNMENTS.map((action, i) => visualEditor.registerToolbarItem({ group: 'align', order: 10 * (i + 1), action })),
      );
    },
  };
}
