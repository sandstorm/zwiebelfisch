import { registerChainButton } from '../../hosts/visual-editor/visual-editor';
import type { Extension } from '../../hosts/workbench/workbench';
import css from './headings.css?inline';
import { calculateNumberingToggle } from './model/heading-numbering';
import { HEADING, HEADING_STYLES } from './visual-editor/visual-editor';
import { HeadingNumbers } from './visual-editor/heading-numbers';
import { headingSearch } from './workbench/heading-search';

/**
 * Headings (`= Title`) in the Visual editor and in search everywhere.
 * - Heading 1–3 in the text style menu
 * - each heading's number in a gutter right of the text, as the document's `#set heading(numbering: ..)` rules give it
 *   (an approximation; the preview shows the real numbers)
 * - the command `headings.toggleNumbering`: turns the active document's heading numbering on or off
 * - "Headings" (prefix `#`) in search everywhere: every Typst file's headings
 */
export function headings(): Extension {
  return {
    id: 'headings',
    contributes: { commands: [{ command: TOGGLE_NUMBERING, title: 'Number headings on / off', category: 'Headings' }] },
    activate({ project, commands, window, workbench, visualEditor, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css), window.registerSearchProvider(headingSearch(project, workbench)));
      subscriptions.push(
        commands.registerCommand(TOGGLE_NUMBERING, () => {
          const document = window.activeTextEditor?.document;
          if (document) document.change(calculateNumberingToggle(document.text), TOGGLE_NUMBERING);
        }),
      );
      subscriptions.push(
        visualEditor.registerNode(HEADING),
        ...HEADING_STYLES.map((style) => registerChainButton({ commands, workbench }, 'visualEditor/textStyle', style)),
        visualEditor.registerTiptapExtension(() => HeadingNumbers),
      );
    },
  };
}

/** Switches heading numbering in the active editor's document on or off (no button: for hosts, menus and search everywhere). */
export const TOGGLE_NUMBERING = 'headings.toggleNumbering';
