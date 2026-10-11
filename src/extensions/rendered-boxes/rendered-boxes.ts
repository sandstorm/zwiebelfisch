import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './rendered-boxes.css?inline';
import { snippetRenderer } from './visual-editor/visual-editor';

/**
 * Raw boxes that show how they look compiled.
 *
 * A raw box holds Typst the Visual editor has no construct for. With this extension it shows its snippet, cut from the
 * preview's pages, until its code gets focus. The picture is refreshed after every compile (`onDidRender`) while the
 * box is near the view.
 *
 * The Visual editor only knows that a box may be drawn by a renderer. Where the pictures come from (the preview, under
 * the document's current path) is decided here. Image boxes are drawn by the images extension's renderer (priority 110,
 * over this one's 100). See docs/40_architecture/04_visual-editor.typ, "Raw boxes".
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
