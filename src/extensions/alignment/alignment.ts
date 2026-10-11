import type { TypstExtension } from '../../hosts/workbench/workbench';
import { ALIGN_MENU, ALIGNMENT, ALIGNMENTS, JUSTIFIED_PARAGRAPH } from './visual-editor/visual-editor';

/**
 * Text alignment in the Visual editor, as Typst writes it: `#align(..)[..]` blocks, `#par(justify: ..)[..]` around one
 * paragraph, the Align menu and Mod-Shift-L/E/R/J.
 *
 * The Visual editor itself knows only paragraphs, text and raw Typst. This extension adds the `alignment` node and
 * gives the host's paragraphs a `justify` flag (a second `paragraph` spec that extends the host's). `#set align(..)` and
 * `#set par(justify: ..)` stay raw Typst; they are only read, to show the alignment they set. An `#align` with anything
 * but a literal alignment stays raw too.
 *
 * `model/` reads and writes the alignment syntax; `visual-editor/` holds the node, its commands and the menu (see
 * TextAlign in visual-editor/text-align.ts). See docs/40_architecture/08_built-in-extensions.typ.
 */
export function alignment(): TypstExtension {
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
