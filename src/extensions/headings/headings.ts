// The headings extension: `= Title` headings in the Visual view, and their numbers as the document's
// `#set heading(numbering: ..)` rules make Typst number them (with the `toggleHeadingNumbering` command). See
// ARCHITECTURE.md, "VisualView". Why one extension: the numbers are a view of the headings, nothing without them.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './headings.css?inline';
import { HEADING } from './visual-view/visual-view';
import { HeadingNumbers } from './visual-view/heading-numbers';

/** Headings and their numbers. */
export function headings(): TypstExtension {
  return {
    id: 'headings',
    activate({ workbench, visualView, subscriptions }) {
      subscriptions.push(workbench.registerStyleSheet(css));
      subscriptions.push(visualView.registerNode(HEADING), visualView.registerEditorExtension(() => HeadingNumbers));
    },
  };
}
