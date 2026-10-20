import type { Extension } from '../../hosts/workbench/workbench';
import css from './figures.css?inline';
import { FIGURE, FIGURE_CAPTION } from './visual-editor/visual-editor';
import { figureSearch } from './workbench/figure-search';

/**
 * Figures (`#figure(body, caption: [..])`) in the Visual editor and in search everywhere.
 * - the caption is rich text; the commands `addFigureCaption`, `removeFigureCaption` and `setFigureCaption` add,
 *   remove and set it
 * - deleting a selected body deletes its figure, caption and all
 * - search everywhere lists every figure by caption (tables and listings too)
 *
 * A figure holds whatever a spec offers as a body by joining the node group `figureBody` (an image, a table); without
 * such a spec no figure is modelled.
 */
export function figures(): Extension {
  return {
    id: 'figures',
    activate({ project, window, visualEditor, subscriptions }) {
      subscriptions.push(
        window.registerStyleSheet(css),
        visualEditor.registerNode(FIGURE),
        visualEditor.registerNode(FIGURE_CAPTION),
        window.registerSearchProvider(figureSearch(project, window)),
      );
    },
  };
}
