import type { Extension } from '../../hosts/workbench/workbench';
import { insertDisplayMath, insertInlineMath, MathInput } from './visual-editor/visual-editor';

/**
 * Typing math in the Visual editor.
 *
 * The closing `$` of `$…$` turns what was typed into the raw box the parser makes for math; Backspace right after
 * gives the text back. With spaces inside both dollars it is display math. A `$` after a backslash, or with a space
 * on one side only, stays text ("$5 and $10").
 *
 * Insert → "Inline math" and "Display math" insert an empty box with the cursor in its code.
 */
export function math(): Extension {
  return {
    id: 'math',
    activate({ visualEditor, subscriptions }) {
      subscriptions.push(
        visualEditor.registerTiptapExtension(() => MathInput),
        visualEditor.registerToolbarItem({ group: 'insert', order: 44, create: ({ editor }) => insertInlineMath(editor) }),
        visualEditor.registerToolbarItem({ group: 'insert', order: 46, create: ({ editor }) => insertDisplayMath(editor) }),
      );
    },
  };
}
