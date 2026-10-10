// What the headings extension contributes to the Visual view: the heading spec (`= Title` as Tiptap's heading node,
// with the label right after it) and the heading numbers. See headings.ts.
import { children } from '../../../core/typst-syntax/typst-syntax';
import { starterKitPart, type TypstNodeSpec } from '../../../hosts/visual-view/visual-view';

/**
 * `= Title` .. `====== Title` (deeper levels count as 6): a heading of its own
 * (block syntax), whose label may stand right after it — same line or the
 * next, followed by a paragraph break, the end or a block (`= A <a> text` is
 * not: Typst reads that label as part of the line). An edited heading prints
 * its level's `=` and its text.
 */
export const HEADING: TypstNodeSpec = {
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
