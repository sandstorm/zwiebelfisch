// The rendered-boxes extension: a raw box in the Visual editor (Typst the view does not model) shows how it looks
// compiled — its snippet cut from the preview's pages — until someone edits its code. Entry of
// extensions/rendered-boxes/. See docs/30_architecture/08_built-in-extensions.typ.
// Why an extension: the Visual editor only knows that a box may be drawn by a renderer; where pictures come from
// (the preview, under the document's current path) is this extension's knowledge.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './rendered-boxes.css?inline';
import { snippetRenderer } from './visual-editor/visual-editor';

/**
 * Raw boxes drawn as compiled snippets from the preview (`Preview.snippet` under the document's current path,
 * refreshed on `onDidRender`; see `snippetRenderer`). Image boxes are drawn by the images' renderer (priority 110
 * over this one's 100).
 */
export function renderedBoxes(): TypstExtension {
  return {
    id: 'rendered-boxes',
    activate({ project, preview, visualEditor, workbench, subscriptions }) {
      subscriptions.push(
        workbench.registerStyleSheet(css),
        visualEditor.registerRawBoxRenderer(({ document }) =>
          snippetRenderer({
            snippet: async (range, text) => {
              const file = project.pathOf(document);
              return file ? preview.snippet(file, range, text) : null;
            },
            onDidChange: preview.onDidRender,
          }),
        ),
      );
    },
  };
}
