// What the headings extension contributes to the Visual view: the heading spec (`= Title` as Tiptap's heading node,
// with the label right after it) and its levels in the text style menu. See headings.ts.
import { children } from '../../../core/typst-syntax/typst-syntax';
import type { TextStyleProvider, TypstNodeSpec } from '../../../hosts/visual-view/visual-view';
import { starterKitPart } from '../../../hosts/projection/projection';

/**
 * `= Title` .. `====== Title` (deeper levels count as 6): a heading of its own
 * (block syntax), whose label may stand right after it — same line or the
 * next, followed by a paragraph break, the end or a block (`= A <a> text` is
 * not: Typst reads that label as part of the line). An edited heading prints
 * its level's `=` and its text.
 */
export const HEADING: TypstNodeSpec = {
  name: 'heading',
  // Tiptap's heading (StarterKit's), with the source anchors
  tiptap: starterKitPart('typstHeading', { heading: { HTMLAttributes: { class: 'typst-headings__heading' } } }).extend({
    addGlobalAttributes: () => [
      { types: ['heading'], attributes: { src: { default: null, rendered: false, keepOnSplit: false }, sep: { default: null, rendered: false } } },
    ],
  }),
  typst: {
    parseTypst: {
      syntaxNodes: {
        Heading: {
          standsAlone: true,
          takesLabel: true,
          block: (p, node, sep) => {
            const level = Math.min(6, (node.getChild('HeadingMarker')?.to ?? node.from + 1) - node.from);
            const markup = node.getChild('Markup');
            return p.textblock({ type: 'heading', attrs: { level, src: p.text(node), sep } }, node.from, markup ? p.inline(children(markup)) : []);
          },
        },
      },
    },
    toTypst: (state, heading, pos) => {
      state.hidden(`${'='.repeat(heading.attrs.level)} `);
      state.textblock(heading, pos);
    },
    labelled: true,
  },
  view: { keepsDom: true },
};

/** "Heading 1" to "Heading 3" in the text style menu, right after Normal text. */
export const HEADING_STYLES: TextStyleProvider = {
  provideTextStyles: () =>
    ([1, 2, 3] as const).map((level) => ({
      id: `heading-${level}`,
      label: `Heading ${level}`,
      order: 10 * level,
      apply: (chain) => chain.setHeading({ level }),
      isActive: (editor) => editor.isActive('heading', { level }),
    })),
};
