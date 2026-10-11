// The markup extension: the Typst markup most text is made of — strong and emphasis, links, raw text (inline code,
// code blocks) and block quotes — in the Visual view, with their toolbar entries. See ARCHITECTURE.md, "VisualView".
// Why an extension: the Visual view's host models only paragraphs, text and raw Typst; every construct beyond that
// is contributed, so the host stays small and a construct can be left out or replaced on its own.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './markup.css?inline';
import {
  BLOCKQUOTE, BOLD, CODE, CODE_BLOCK, INSERT_CODE_BLOCK, INSERT_QUOTE, ITALIC, LINK, linkAction, linkShortcut, MARK_ACTIONS,
} from './visual-view/visual-view';

/** Links' mark priority: outside bold and italic (100) where they cover the same text. */
const LINK_PRIORITY = 120;

/**
 * Strong, emphasis, links, inline code, code blocks and block quotes: their nodes, marks and buttons. Where marks
 * cover the same text, a link is outermost (`LINK_PRIORITY`), then bold, italic; inline code prints innermost
 * whatever the schema's order (`raw`).
 */
export const markup: TypstExtension = {
  id: 'markup',
  activate({ workbench, visualView, subscriptions }) {
    subscriptions.push(workbench.registerStyleSheet(css));
    subscriptions.push(
      visualView.registerMark(BOLD),
      visualView.registerMark(ITALIC),
      visualView.registerMark(LINK, { priority: LINK_PRIORITY }),
      visualView.registerMark(CODE),
      visualView.registerNode(CODE_BLOCK),
      visualView.registerNode(BLOCKQUOTE),
      // in the bar above a selection, their only place
      ...[MARK_ACTIONS.bold, MARK_ACTIONS.italic, MARK_ACTIONS.code].map((action, i) =>
        visualView.registerToolbarItem({ group: 'selection', order: 10 * (i + 1), action }),
      ),
      visualView.registerToolbarItem({ group: 'selection', order: 40, create: (toolbar) => linkAction(toolbar, workbench) }),
      visualView.registerEditorExtension(linkShortcut(workbench)),
      visualView.registerToolbarItem({ group: 'insert', order: 40, action: INSERT_CODE_BLOCK }),
      visualView.registerToolbarItem({ group: 'insert', order: 50, action: INSERT_QUOTE }),
    );
  },
};
