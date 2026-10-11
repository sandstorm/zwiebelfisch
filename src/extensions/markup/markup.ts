// The markup extension: the Typst markup most text is made of — strong and emphasis, links, raw text (inline code,
// code blocks) and block quotes — in the Visual view, with their toolbar entries. See docs/architecture/built-in-extensions.typ.
// Why an extension: the Visual view's host models only paragraphs, text and raw Typst; every construct beyond that
// is contributed, so the host stays small and a construct can be left out or replaced on its own.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './markup.css?inline';
import {
  BLOCKQUOTE, BOLD, CODE, CODE_BLOCK, INSERT_CODE_BLOCK, INSERT_QUOTE, ITALIC, LINK, linkAction, linkShortcut, MARK_ACTIONS,
} from './visual-view/visual-view';

/**
 * Strong, emphasis, links, inline code, code blocks and block quotes: their nodes, marks and buttons. Where marks
 * cover the same text, a link is outermost (its Tiptap priority, 120), then bold, italic; inline code is written
 * innermost whatever the schema's order (`raw`).
 */
export function markup(): TypstExtension {
  return {
    id: 'markup',
    activate({ window, workbench, visualView, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      subscriptions.push(
        visualView.registerMark(BOLD),
        visualView.registerMark(ITALIC),
        visualView.registerMark(LINK),
        visualView.registerMark(CODE),
        visualView.registerNode(CODE_BLOCK),
        visualView.registerNode(BLOCKQUOTE),
        // in the bar above a selection, their only place
        ...[MARK_ACTIONS.bold, MARK_ACTIONS.italic, MARK_ACTIONS.code].map((action, i) =>
          visualView.registerToolbarItem({ group: 'selection', order: 10 * (i + 1), action }),
        ),
        visualView.registerToolbarItem({ group: 'selection', order: 40, create: (toolbar) => linkAction(toolbar, window) }),
        visualView.registerTiptapExtension(() => linkShortcut(window)),
        visualView.registerToolbarItem({ group: 'insert', order: 40, action: INSERT_CODE_BLOCK }),
        visualView.registerToolbarItem({ group: 'insert', order: 50, action: INSERT_QUOTE }),
      );
    },
  };
}
