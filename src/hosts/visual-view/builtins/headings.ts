// Headings: `= Title` as Tiptap's heading node, with the label right after it. See builtins.ts.
import type { TypstNodeSpec, VisualViewContribution } from '../contributions/contributions';
import { starterKitPart } from '../nodes/nodes';
import { children } from '../projection/projection';

/**
 * `= Title` .. `====== Title` (deeper levels count as 6): a heading of its own
 * (block syntax), whose label may stand right after it — same line or the
 * next, followed by a paragraph break, the end or a block (`= A <a> text` is
 * not: Typst reads that label as part of the line). An edited heading prints
 * its level's `=` and its text.
 */
export const headings: VisualViewContribution = {
  id: 'headings',
  activate({ visualView, subscriptions }) {
    subscriptions.push(visualView.registerNode(HEADING));
  },
};

const HEADING: TypstNodeSpec = {
  name: 'heading',
  extension: starterKitPart('typstHeading', { heading: {} }),
  attributes: {
    src: { default: null, rendered: false, keepOnSplit: false },
    sep: { default: null, rendered: false },
  },
  keepsDom: true,
  labelled: true,
  blockSyntax: {
    Heading: {
      takesLabel: true,
      project: (p, node, sep) => {
        const level = Math.min(6, (node.getChild('HeadingMarker')?.to ?? node.from + 1) - node.from);
        const markup = node.getChild('Markup');
        return p.textblock({ type: 'heading', attrs: { level, src: p.text(node), sep } }, node.from, markup ? p.inline(children(markup)) : []);
      },
    },
  },
  print: (out, heading, pos) => {
    out.hidden(`${'='.repeat(heading.attrs.level)} `);
    out.textblock(heading, pos);
  },
};
