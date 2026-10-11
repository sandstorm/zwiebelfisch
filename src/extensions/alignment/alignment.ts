// The alignment extension. See docs/30_architecture/08_built-in-extensions.typ.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { ALIGN_MENU, ALIGNMENT, ALIGNMENTS, JUSTIFIED_PARAGRAPH } from './visual-editor/visual-editor';

/**
 * Aligned blocks, justified paragraphs and the Align menu.
 *
 * Text alignment as Typst writes it — `#align(..)[..]` blocks and `#par(justify: ..)[..]` paragraphs — in the Visual
 * editor, with the Align menu and Mod-Shift-L/E/R/J.
 *
 * Why an extension: the Visual editor's host models only paragraphs, text and raw Typst; this one also teaches the
 * host's paragraphs their `justify` (a second paragraph spec extends the host's).
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
