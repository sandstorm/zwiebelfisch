import type { Extension } from '../../hosts/workbench/workbench';
import css from './figures.css?inline';
import { FIGURE, FIGURE_CAPTION } from './visual-editor/visual-editor';
import { figureSearch } from './workbench/figure-search';

/**
 * `#figure(body, caption: [..])` in the Visual editor, with the caption as rich text and the commands
 * `addFigureCaption` / `removeFigureCaption` / `setFigureCaption` (an image box's tools offer the last); deleting a
 * selected body deletes its figure (caption and all); and every figure (tables and listings
 * too) in search everywhere, by caption.
 *
 * A figure frames whatever another construct offers as a body, an image or a table, through the node group
 * `figureBody` that their specs join. So images and tables do not know figures, and figures know neither. Without an
 * extension that offers a body, no figure is modelled. See docs/40_architecture/08_extensions.typ.
 */
export function figures(): Extension {
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
