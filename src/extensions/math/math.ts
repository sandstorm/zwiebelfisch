import type { TypstExtension } from '../../hosts/workbench/workbench';
import { insertDisplayMath, insertInlineMath, MathInput } from './visual-editor/visual-editor';

/**
 * Writing math in the Visual editor. Typst math (`$a^1$`, `$ x $`) is not modelled: the parser keeps it as a raw box
 * (`rawInline` or `rawBlock` with the math as its `src`), edited as code and drawn by the box renderer like any other.
 * Typed in the text, though, a `$` is a character and printed escaped (`\$`). This extension makes typing math work:
 * the closing `$` of `$…$` turns what was typed into the raw box the parser would make (Backspace right after gives
 * the text back). With spaces inside both dollars it is display math: alone in a paragraph, a block box; else inline.
 * A `$` after a backslash, after an escaped `\$` from the source, or with a space on one side only stays text
 * ("$5 and $10").
 *
 * For an empty start, Insert → "Inline math" (`$$`) and "Display math" (`$  $`) insert the box with the cursor inside
 * its code (the host's `editRawBox`); the slash commands find them under "math", "equation", "formula".
 * See docs/20_features/04_full-typst-support.typ.
 */
export function math(): TypstExtension {
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
