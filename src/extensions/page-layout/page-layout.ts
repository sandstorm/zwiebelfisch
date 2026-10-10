// The page-layout extension: what divides a document's pages and parts — `#pagebreak()` and a full-width
// `#line(length: 100%)` — as block atoms in the Visual view (a labelled divider, a rule), with their entries in the
// Insert menu. See ARCHITECTURE.md, "VisualView". Why an extension: the Visual view's host models only paragraphs,
// text and raw Typst; without it these calls stay raw boxes.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { HORIZONTAL_RULE, INSERT_HORIZONTAL_RULE, INSERT_PAGE_BREAK, PAGE_BREAK } from './visual-view/visual-view';

/** Page breaks and horizontal rules. */
export const pageLayout: TypstExtension = {
  id: 'page-layout',
  activate({ visualView, subscriptions }) {
    subscriptions.push(
      visualView.registerNode(PAGE_BREAK),
      visualView.registerNode(HORIZONTAL_RULE),
      visualView.registerToolbarItem({ group: 'insert', order: 60, action: INSERT_PAGE_BREAK }),
      visualView.registerToolbarItem({ group: 'insert', order: 70, action: INSERT_HORIZONTAL_RULE }),
    );
  },
};
