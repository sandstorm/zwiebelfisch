import type { Extension } from '../../hosts/workbench/workbench';
import { MathInput, registerInsertMath } from './visual-editor/visual-editor';

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
    activate(context) {
      context.subscriptions.push(context.visualEditor.registerTiptapExtension(() => MathInput), registerInsertMath(context));
    },
  };
}
