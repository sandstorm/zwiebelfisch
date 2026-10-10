// The headings extension: `= Title` headings in the Visual view, and their numbers as the document's
// `#set heading(numbering: ..)` rules make Typst number them (with the `toggleHeadingNumbering` command). See
// ARCHITECTURE.md, "VisualView". Why one extension: the numbers are a view of the headings, nothing without them.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import { HEADING, HeadingNumbers } from './visual-view/visual-view';

/** Headings and their numbers. */
export const headings: TypstExtension = {
  id: 'headings',
  activate({ visualView, subscriptions }) {
    subscriptions.push(visualView.registerNode(HEADING), visualView.registerEditorExtension(() => HeadingNumbers));
  },
};
