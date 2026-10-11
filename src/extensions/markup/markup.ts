import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './markup.css?inline';
import {
  BLOCKQUOTE, BOLD, CODE, CODE_BLOCK, INSERT_CODE_BLOCK, INSERT_QUOTE, ITALIC, LINK, linkAction, linkShortcut, MARK_ACTIONS, UNDERLINE,
} from './visual-editor/visual-editor';

/**
 * The Typst markup most text is made of, in the Visual editor: strong, emphasis and underline, links, raw text (inline
 * code, code blocks) and block quotes, with their buttons in the selection's bar and the Insert menu.
 *
 * The Visual editor itself knows only paragraphs, text and raw boxes. Every other construct is contributed, so it can be
 * left out or replaced on its own; this is the most basic set. Where marks cover the same text, a link is outermost
 * (its Tiptap priority, 120), then bold, then italic, then underline; inline code is always written innermost (`raw`).
 * See docs/20_extensions/03_visual-editor-constructs.typ.
 */
export function markup(): TypstExtension {
  return {
    id: 'markup',
    activate({ window, workbench, visualEditor, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      subscriptions.push(
        visualEditor.registerMark(BOLD),
        visualEditor.registerMark(ITALIC),
        visualEditor.registerMark(UNDERLINE),
        visualEditor.registerMark(LINK),
        visualEditor.registerMark(CODE),
        visualEditor.registerNode(CODE_BLOCK),
        visualEditor.registerNode(BLOCKQUOTE),
        // in the bar above a selection, their only place
        ...[MARK_ACTIONS.bold, MARK_ACTIONS.italic, MARK_ACTIONS.underline, MARK_ACTIONS.code].map((action, i) =>
          visualEditor.registerToolbarItem({ group: 'selection', order: 10 * (i + 1), action }),
        ),
        visualEditor.registerToolbarItem({ group: 'selection', order: 50, create: (toolbar) => linkAction(toolbar, window) }),
        visualEditor.registerTiptapExtension(() => linkShortcut(window)),
        visualEditor.registerToolbarItem({ group: 'insert', order: 40, action: INSERT_CODE_BLOCK }),
        visualEditor.registerToolbarItem({ group: 'insert', order: 50, action: INSERT_QUOTE }),
      );
    },
  };
}
