import { registerChainButton } from '../../hosts/visual-editor/visual-editor';
import type { Extension } from '../../hosts/workbench/workbench';
import css from './page-layout.css?inline';
import { HORIZONTAL_RULE, INSERT_HORIZONTAL_RULE } from './visual-editor/horizontal-rule';
import { INSERT_PAGE_BREAK, PAGE_BREAK } from './visual-editor/page-break';

/**
 * Page breaks and horizontal rules in the Visual editor.
 *
 * - `#pagebreak()` shows as a labelled divider; Mod+Enter inserts one.
 * - A full-width `#line(length: 100%)` shows as a rule; `---` in an empty paragraph inserts one.
 *
 * Both are in the Insert menu, and their source is kept as written.
 */
export function pageLayout(): Extension {
  return {
    id: 'page-layout',
    activate(context) {
      const { window, visualEditor, subscriptions } = context;
      subscriptions.push(window.registerStyleSheet(css));
      subscriptions.push(
        visualEditor.registerNode(PAGE_BREAK),
        visualEditor.registerNode(HORIZONTAL_RULE),
        registerChainButton(context, 'visualEditor/insert', INSERT_PAGE_BREAK),
        registerChainButton(context, 'visualEditor/insert', INSERT_HORIZONTAL_RULE),
      );
    },
  };
}
