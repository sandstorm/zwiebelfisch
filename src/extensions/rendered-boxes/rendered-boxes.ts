import type { Extension } from '../../hosts/workbench/workbench';
import css from './rendered-boxes.css?inline';
import { snippetRenderer } from './visual-editor/visual-editor';

/**
 * Raw boxes in the Visual editor show how they look compiled.
 *
 * A raw box holds Typst the Visual editor has no construct for. With this extension it shows its snippet, cut from the
 * preview's pages, until its code gets focus; the picture is refreshed after every compile. Boxes that draw nothing
 * where they stand (`#set`, `#let`, comments) keep showing code.
 */
export function renderedBoxes(): Extension {
  return {
    id: 'rendered-boxes',
    activate({ project, preview, visualEditor, window, subscriptions }) {
      subscriptions.push(
        window.registerStyleSheet(css),
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
