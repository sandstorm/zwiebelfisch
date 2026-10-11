// The page-layout extension: what divides a document's pages and parts — `#pagebreak()` and a full-width
// `#line(length: 100%)` — as block atoms in the Visual view (a labelled divider, a rule), with their entries in the
// Insert menu. See docs/30_architecture/08_built-in-extensions.typ. Why an extension: the Visual view's host models only paragraphs,
// text and raw Typst; without it these calls stay raw boxes.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './page-layout.css?inline';
import { HORIZONTAL_RULE, INSERT_HORIZONTAL_RULE } from './visual-view/horizontal-rule';
import { INSERT_PAGE_BREAK, PAGE_BREAK } from './visual-view/page-break';

/** Page breaks and horizontal rules. */
export function pageLayout(): TypstExtension {
  return {
    id: 'page-layout',
    activate({ workbench, visualView, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      subscriptions.push(
        visualView.registerNode(PAGE_BREAK),
        visualView.registerNode(HORIZONTAL_RULE),
        visualView.registerToolbarItem({ group: 'insert', order: 60, action: INSERT_PAGE_BREAK }),
        visualView.registerToolbarItem({ group: 'insert', order: 70, action: INSERT_HORIZONTAL_RULE }),
      );
    },
  };
}
