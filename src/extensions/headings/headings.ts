// The headings extension: `= Title` headings in the Visual view (Heading 1–3 in the text style menu), and their
// numbers as the document's `#set heading(numbering: ..)` rules make Typst number them (with the command
// `headings.toggleNumbering`), and every Typst file's headings in search everywhere. See
// docs/architecture/built-in-extensions.typ. Why one extension: the numbers are a view of the headings, nothing without them.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './headings.css?inline';
import { calculateNumberingToggle } from './model/heading-numbering';
import { HEADING, HEADING_STYLES } from './visual-view/visual-view';
import { HeadingNumbers } from './visual-view/heading-numbers';
import { headingSearch } from './workbench/heading-search';

/** Switches heading numbering in the active editor's document on or off (no button: for hosts, menus and search everywhere). */
export const TOGGLE_NUMBERING = 'headings.toggleNumbering';

/**
 * Headings and their numbers. The command `headings.toggleNumbering` adds `#set heading(numbering: "1.")` after the
 * code the active editor's document starts with, or removes the document's heading numbering.
 */
export function headings(): TypstExtension {
  return {
    id: 'headings',
    contributes: { commands: [{ command: TOGGLE_NUMBERING, title: 'Number headings on / off', category: 'Headings' }] },
    activate({ project, commands, window, workbench, visualView, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css), window.registerSearchProvider(headingSearch(project, workbench)));
      subscriptions.push(
        commands.registerCommand(TOGGLE_NUMBERING, () => {
          const document = window.activeTextEditor?.document;
          if (document) document.change(calculateNumberingToggle(document.text), TOGGLE_NUMBERING);
        }),
      );
      subscriptions.push(
        visualView.registerNode(HEADING),
        visualView.registerTextStyleProvider(HEADING_STYLES),
        visualView.registerTiptapExtension(() => HeadingNumbers),
      );
    },
  };
}
