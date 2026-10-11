// The outline extension: the table of contents, a standalone `#outline(..)`, as a box headed "Table of contents" in
// the Visual editor (showing the compiled outline where a box renderer draws it), and "Insert" → "Table of contents".
// See docs/30_architecture/08_built-in-extensions.typ. Why an extension: the Visual editor's host models only paragraphs, text and raw
// Typst.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { INSERT_OUTLINE, OUTLINE } from './visual-editor/visual-editor';

/** The table of contents. */
export function outline(): TypstExtension {
  return {
    id: 'outline',
    activate({ visualEditor, subscriptions }) {
      subscriptions.push(visualEditor.registerNode(OUTLINE), visualEditor.registerToolbarItem({ group: 'insert', order: 30, action: INSERT_OUTLINE }));
    },
  };
}
