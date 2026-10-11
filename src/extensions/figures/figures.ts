// The figures extension: `#figure(body, caption: [..])` in the Visual editor, its caption as rich text, and the
// commands `addFigureCaption` / `removeFigureCaption` (which an image box's tools offer). Entry of
// extensions/figures/. See docs/30_architecture/08_built-in-extensions.typ. Why an extension of its own: a figure frames whatever
// another construct offers as a body — an image, a table — through the node group `figureBody` their specs join, so
// neither knows the other, and figures know neither.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './figures.css?inline';
import { FIGURE, FIGURE_CAPTION } from './visual-editor/visual-editor';
import { figureSearch } from './workbench/figure-search';

/**
 * Figures of the bodies the other constructs offer (`figureBody`; at least one must, as images and tables do), and
 * every figure (table, listing) in search everywhere, by caption.
 */
export function figures(): TypstExtension {
  return {
    id: 'figures',
    activate({ project, window, workbench, visualEditor, subscriptions }) {
      subscriptions.push(
        workbench.registerStyleSheet(css),
        visualEditor.registerNode(FIGURE),
        visualEditor.registerNode(FIGURE_CAPTION),
        window.registerSearchProvider(figureSearch(project, workbench)),
      );
    },
  };
}
