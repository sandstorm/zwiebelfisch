import type { Extension } from '../../hosts/workbench/workbench';
import css from './markup.css?inline';
import {
  BLOCKQUOTE, BOLD, CODE, CODE_BLOCK, HARD_BREAK, HIGHLIGHT, INSERT_CODE_BLOCK, INSERT_QUOTE, ITALIC, LINK, linkAction, linkShortcut, MARK_ACTIONS, STRIKE,
  UNDERLINE,
} from './visual-editor/visual-editor';
import { urlLinks } from './workbench/url-links';

/**
 * The basic Typst markup in the Visual editor: strong, emphasis, underline, strike, highlight, links, inline code,
 * code blocks, block quotes and line breaks (`\`, Shift+Enter).
 *
 * Each comes with its button in the bar above a selection or in the Insert menu. Web and mail addresses are document
 * links in every editor: ⌘/Ctrl+click or Alt+Enter opens them in a new tab.
 *
 * Marks on the same text are written in a fixed order, link outermost and code innermost:
 * `*#underline[#strike[#highlight[x]]]*`. Underline, strike and highlight with arguments stay raw boxes.
 */
export function markup(): Extension {
  return {
    id: 'markup',
    activate({ window, workbench, languages, visualEditor, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css), languages.registerDocumentLinkProvider({ language: 'typst' }, urlLinks));
      subscriptions.push(
        visualEditor.registerMark(BOLD),
        visualEditor.registerMark(ITALIC),
        visualEditor.registerMark(UNDERLINE),
        visualEditor.registerMark(STRIKE),
        visualEditor.registerMark(HIGHLIGHT),
        visualEditor.registerMark(LINK),
        visualEditor.registerMark(CODE),
        visualEditor.registerNode(CODE_BLOCK),
        visualEditor.registerNode(BLOCKQUOTE),
        visualEditor.registerNode(HARD_BREAK),
        // in the bar above a selection, their only place
        ...[MARK_ACTIONS.bold, MARK_ACTIONS.italic, MARK_ACTIONS.underline, MARK_ACTIONS.strike, MARK_ACTIONS.highlight, MARK_ACTIONS.code].map(
          (action, i) => visualEditor.registerToolbarItem({ group: 'selection', order: 10 + 5 * i, action }),
        ),
        visualEditor.registerToolbarItem({ group: 'selection', order: 50, create: (toolbar) => linkAction(toolbar, window) }),
        visualEditor.registerTiptapExtension(() => linkShortcut(window)),
        visualEditor.registerToolbarItem({ group: 'insert', order: 40, action: INSERT_CODE_BLOCK }),
        visualEditor.registerToolbarItem({ group: 'insert', order: 50, action: INSERT_QUOTE }),
      );
    },
  };
}
