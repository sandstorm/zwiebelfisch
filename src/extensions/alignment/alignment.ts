// The alignment extension: text alignment as Typst writes it — `#align(..)[..]` blocks and `#par(justify: ..)[..]`
// paragraphs — in the Visual view, with the Align menu and Mod-Shift-L/E/R/J. See ARCHITECTURE.md, "VisualView".
// Why an extension: the Visual view's host models only paragraphs, text and raw Typst; this one also teaches the
// host's paragraphs their `justify` (a second paragraph spec extends the host's).
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { ALIGN_MENU, ALIGNMENT, ALIGNMENTS, JUSTIFIED_PARAGRAPH } from './visual-view/visual-view';

/** Aligned blocks, justified paragraphs and the Align menu. */
export function alignment(): TypstExtension {
  return {
    id: 'alignment',
    activate({ visualView, subscriptions }) {
      subscriptions.push(
        visualView.registerNode(ALIGNMENT),
        visualView.registerNode(JUSTIFIED_PARAGRAPH),
        visualView.registerToolbarGroup(ALIGN_MENU),
        ...ALIGNMENTS.map((action, i) => visualView.registerToolbarItem({ group: 'align', order: 10 * (i + 1), action })),
      );
    },
  };
}
