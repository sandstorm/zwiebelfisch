import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './markup.css?inline';
import {
  BLOCKQUOTE, BOLD, CODE, CODE_BLOCK, HIGHLIGHT, INSERT_CODE_BLOCK, INSERT_QUOTE, ITALIC, LINK, linkAction, linkShortcut, MARK_ACTIONS, STRIKE,
  UNDERLINE,
} from './visual-editor/visual-editor';
import { urlLinks } from './workbench/url-links';

/**
 * The Typst markup most text is made of, in the Visual editor: strong, emphasis, underline, strike and highlight, links,
 * raw text (inline code, code blocks) and block quotes, with their buttons in the selection's bar and the Insert menu.
 *
 * The Visual editor itself knows only paragraphs, text and raw boxes. Every other construct is contributed, so it can be
 * left out or replaced on its own; this is the most basic set. Where marks cover the same text, a link is outermost
 * (its Tiptap priority, 120), then bold, italic, underline, strike and highlight in that order (the order they are
 * registered in, all at priority 100: `*#underline[#strike[#highlight[x]]]*`); inline code is always written innermost
 * (`raw`). Underline, strike and highlight are marks only in their plain form (`#strike[x]`); with arguments they stay
 * raw boxes. Web and mail addresses are document links in every editor: ⌘/Ctrl+click or Alt+Enter opens them in a new
 * tab. See docs/40_architecture/11_visual-editor-constructs.typ.
 */
export function markup(): TypstExtension {
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
