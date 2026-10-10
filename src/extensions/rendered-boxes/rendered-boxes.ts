// The rendered-boxes extension: a raw box in the Visual view (Typst the view does not model) shows how it looks
// compiled — its snippet cut from the preview's pages — until someone edits its code. Entry of
// extensions/rendered-boxes/. See ARCHITECTURE.md, "createTypstEditor".
// Why an extension: the Visual view only knows that a box may be drawn by a renderer; where pictures come from
// (the preview, under the document's current path) is this extension's knowledge.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { renderedBoxesVisualView } from './visual-view/visual-view';

export { renderedBoxesVisualView, type SnippetSource } from './visual-view/visual-view';

/**
 * Raw boxes drawn as compiled snippets from the preview (`Preview.snippet` under the document's current path,
 * refreshed on `onDidRender`). In the built-in list after `images`, whose renderer draws image boxes.
 */
export function renderedBoxes(): TypstExtension {
  return {
    id: 'rendered-boxes',
    activate(context) {
      const { project, preview } = context;
      renderedBoxesVisualView({
        snippets: (document) => ({
          snippet: async (from, to, text) => {
            const file = project.pathOf(document);
            return file ? preview.snippet(file, from, to, text) : null;
          },
          onDidChange: preview.onDidRender,
        }),
      }).activate(context);
    },
  };
}
