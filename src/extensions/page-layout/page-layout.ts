// The page-layout extension. See docs/30_architecture/08_built-in-extensions.typ.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './page-layout.css?inline';
import { HORIZONTAL_RULE, INSERT_HORIZONTAL_RULE } from './visual-editor/horizontal-rule';
import { INSERT_PAGE_BREAK, PAGE_BREAK } from './visual-editor/page-break';

/**
 * Page breaks and horizontal rules.
 *
 * What divides a document's pages and parts — `#pagebreak()` and a full-width `#line(length: 100%)` — as block atoms in
 * the Visual editor (a labelled divider, a rule), with their entries in the Insert menu. Why an extension: the Visual
 * editor's host models only paragraphs, text and raw Typst; without it these calls stay raw boxes.
 */
export function pageLayout(): TypstExtension {
  return {
    id: 'page-layout',
    activate({ workbench, visualEditor, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      subscriptions.push(
        visualEditor.registerNode(PAGE_BREAK),
        visualEditor.registerNode(HORIZONTAL_RULE),
        visualEditor.registerToolbarItem({ group: 'insert', order: 60, action: INSERT_PAGE_BREAK }),
        visualEditor.registerToolbarItem({ group: 'insert', order: 70, action: INSERT_HORIZONTAL_RULE }),
      );
    },
  };
}
