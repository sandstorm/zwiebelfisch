import type { Extension } from '../../hosts/workbench/workbench';
import css from './page-layout.css?inline';
import { HORIZONTAL_RULE, INSERT_HORIZONTAL_RULE } from './visual-editor/horizontal-rule';
import { INSERT_PAGE_BREAK, PAGE_BREAK } from './visual-editor/page-break';

/**
 * Page breaks and horizontal rules in the Visual editor.
 *
 * `#pagebreak()` shows as a labelled divider (Mod+Enter), a full-width `#line(length: 100%)` as a rule (`---` at the
 * start of an empty paragraph); both are in the Insert menu. Their source is kept as written. Without this extension
 * these calls are raw boxes, like any Typst the Visual editor has no construct for.
 * See docs/20_features/04_full-typst-support.typ.
 */
export function pageLayout(): Extension {
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
