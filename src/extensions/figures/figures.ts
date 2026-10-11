// The figures extension: `#figure(body, caption: [..])` in the Visual view, its caption as rich text, and the
// commands `addFigureCaption` / `removeFigureCaption` (which an image box's tools offer). Entry of
// extensions/figures/. See docs/architecture/built-in-extensions.typ. Why an extension of its own: a figure frames whatever
// another construct offers as a body — an image, a table — through the node group `figureBody` their specs join, so
// neither knows the other, and figures know neither.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './figures.css?inline';
import { FIGURE, FIGURE_CAPTION } from './visual-view/visual-view';

/** Figures of the bodies the other constructs offer (`figureBody`; at least one must, as images and tables do). */
export function figures(): TypstExtension {
  return {
    id: 'figures',
    activate({ workbench, visualView, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css), visualView.registerNode(FIGURE), visualView.registerNode(FIGURE_CAPTION));
    },
  };
}
