import type { Extension } from '../../hosts/extension-host/extension-host';
import css from './markup.css?inline';
import { registerChainButton } from '../../hosts/visual-editor/visual-editor';
import {
  BLOCKQUOTE, BOLD, CODE, CODE_BLOCK, HARD_BREAK, HIGHLIGHT, INSERT_BUTTONS, ITALIC, LINK, LINK_BAR, LINK_BUTTON, LINK_COMMAND, linkCommand, linkShortcut, MARK_BUTTONS,
  STRIKE, UNDERLINE,
} from './visual-editor/visual-editor';
import { urlLinks } from './window/url-links';

/**
 * The basic Typst markup in the Visual editor: strong, emphasis, underline, strike, highlight, links, inline code,
 * code blocks, block quotes and line breaks (`\`, Shift+Enter).
 *
 * Each comes with its button in the bar above a selection or in the Insert menu; a link holding the caret has a bar of
 * its own, to edit it. Web and mail addresses are document
 * links in every editor: ⌘/Ctrl+click or Alt+Enter opens them in a new tab.
 *
 * Marks on the same text are written in a fixed order, link outermost and code innermost:
 * `*#underline[#strike[#highlight[x]]]*`. Underline, strike and highlight with arguments stay raw boxes.
 */
export function markup(): Extension {
  return {
    id: 'markup',
    activate(context) {
      const { window, commands, languages, visualEditor, subscriptions } = context;
      subscriptions.push(window.registerStyleSheet(css), languages.registerDocumentLinkProvider({ language: 'typst' }, urlLinks));
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
        ...MARK_BUTTONS.map((button) => registerChainButton(context, 'visualEditor/selection', button)),
        commands.registerCommand(LINK_COMMAND, linkCommand(window)),
        window.registerMenuItem('visualEditor/selection', LINK_BUTTON),
        visualEditor.registerFloatingBar(LINK_BAR),
        window.registerMenuItem(LINK_BAR.id, LINK_BUTTON),
        visualEditor.registerTiptapExtension(linkShortcut(window)),
        ...INSERT_BUTTONS.map((button) => registerChainButton(context, 'visualEditor/insert', button)),
      );
    },
  };
}
