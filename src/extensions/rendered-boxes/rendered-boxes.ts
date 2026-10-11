// The rendered-boxes extension: a raw box in the Visual view (Typst the view does not model) shows how it looks
// compiled — its snippet cut from the preview's pages — until someone edits its code. Entry of
// extensions/rendered-boxes/. See ARCHITECTURE.md, "createTypstEditor".
// Why an extension: the Visual view only knows that a box may be drawn by a renderer; where pictures come from
// (the preview, under the document's current path) is this extension's knowledge.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { snippetRenderer } from './visual-view/visual-view';

/**
 * Raw boxes drawn as compiled snippets from the preview (`Preview.snippet` under the document's current path,
 * refreshed on `onDidRender`; see `snippetRenderer`). Image boxes are drawn by the images' renderer (priority 110
 * over this one's 100).
 */
export function renderedBoxes(): TypstExtension {
  return {
    id: 'rendered-boxes',
    activate({ project, preview, visualView, subscriptions }) {
      subscriptions.push(
        visualView.registerBoxRenderer(({ document }) =>
          snippetRenderer({
            snippet: async (from, to, text) => {
              const file = project.pathOf(document);
              return file ? preview.snippet(file, from, to, text) : null;
            },
            onDidChange: preview.onDidRender,
          }),
        ),
      );
    },
  };
}
