// The outline extension: the table of contents, a standalone `#outline(..)`, as a box headed "Table of contents" in
// the Visual view (showing the compiled outline where a box renderer draws it), and "Insert" → "Table of contents".
// See docs/30_architecture/08_built-in-extensions.typ. Why an extension: the Visual view's host models only paragraphs, text and raw
// Typst.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { INSERT_OUTLINE, OUTLINE } from './visual-view/visual-view';

/** The table of contents. */
export function outline(): TypstExtension {
  return {
    id: 'outline',
    activate({ visualView, subscriptions }) {
      subscriptions.push(visualView.registerNode(OUTLINE), visualView.registerToolbarItem({ group: 'insert', order: 30, action: INSERT_OUTLINE }));
    },
  };
}
