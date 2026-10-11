// The headings extension: `= Title` headings in the Visual view (Heading 1–3 in the text style menu), and their
// numbers as the document's `#set heading(numbering: ..)` rules make Typst number them (with the
// `toggleHeadingNumbering` command). See ARCHITECTURE.md, "VisualView". Why one extension: the numbers are a view of the headings, nothing without them.
import type { TypstExtension } from '../../hosts/workbench/workbench';
import css from './headings.css?inline';
import { HEADING, HEADING_STYLES } from './visual-view/visual-view';
import { HeadingNumbers } from './visual-view/heading-numbers';

/** Headings and their numbers. */
export const headings: TypstExtension = {
  id: 'headings',
  activate({ workbench, visualView, subscriptions }) {
    subscriptions.push(workbench.registerStyleSheet(css));
    subscriptions.push(
      visualView.registerNode(HEADING),
      visualView.registerTextStyleProvider(HEADING_STYLES),
      visualView.registerEditorExtension(() => HeadingNumbers),
    );
  },
};
