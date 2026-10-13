import type { Extension } from '../../hosts/workbench/workbench';
import css from './headings.css?inline';
import { calculateNumberingToggle } from './model/heading-numbering';
import { HEADING, HEADING_STYLES } from './visual-editor/visual-editor';
import { HeadingNumbers } from './visual-editor/heading-numbers';
import { headingSearch } from './workbench/heading-search';

/**
 * `= Title` headings in the Visual editor (Heading 1–3 in the text style menu) with their numbers in a gutter right of
 * the text, the command `headings.toggleNumbering`, and every Typst file's headings in search everywhere ("Headings",
 * prefix `#`).
 *
 * The editor computes the numbers as Typst would from the document's `#set heading(numbering: ..)` rules (HeadingCounter
 * in model/heading-numbering.ts, an approximation; the preview shows the real ones). The numbers are a view of the
 * headings, nothing without them, so both are one extension. The command adds `#set heading(numbering: "1.")` after
 * the code the active editor's document starts with, or removes the document's heading numbering.
 * See docs/40_architecture/08_extensions.typ.
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
        visualEditor.registerTextStyleProvider(HEADING_STYLES),
        visualEditor.registerTiptapExtension(() => HeadingNumbers),
      );
    },
  };
}

/** Switches heading numbering in the active editor's document on or off (no button: for hosts, menus and search everywhere). */
export const TOGGLE_NUMBERING = 'headings.toggleNumbering';
