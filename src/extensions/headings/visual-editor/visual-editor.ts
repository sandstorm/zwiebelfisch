// The heading node and its levels in the text style menu. See headings in ../headings.ts.
import { textblockTypeInputRule, type AnyExtension, type Node as NodeExtension } from '@tiptap/core';
import { children } from '../../../core/typst-syntax/typst-syntax';
import { type ChainButton, type TypstNodeSpec } from '../../../hosts/visual-editor/visual-editor';
import { starterKitPart } from '../../../hosts/visual-editor/typst-conversion/typst-conversion';

/**
 * `= Title` .. `====== Title` (deeper levels count as 6): a heading of its own
 * (block syntax), whose label may stand right after it — same line or the
 * next, followed by a paragraph break, the end or a block (`= A <a> text` is
 * not: Typst reads that label as part of the line). An edited heading prints
 * its level's `=` and its text.
 */
export const HEADING: TypstNodeSpec = {
  name: 'heading',
  // Tiptap's heading (StarterKit's), typed as in Typst, with the source anchors
  tiptap: starterKitPart('typstHeading', { heading: { HTMLAttributes: { class: 'zwf-headings__heading' } } })
    .extend({
      addExtensions() {
        return (this.parent?.() ?? []).map((heading: AnyExtension) =>
          (heading as NodeExtension).extend({
            addInputRules() {
              return [textblockTypeInputRule({ find: HEADING_INPUT, type: this.type, getAttributes: (match) => ({ level: match[1].length }) })];
            },
          }),
        );
      },
    })
    .extend({
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

/** Typed at a line start: `= ` .. `====== ` (Typst), or Markdown's `# ` .. `###### `, makes the line a heading of that level. */
const HEADING_INPUT = /^(={1,6}|#{1,6})\s$/;

/**
 * "Heading 1" to "Heading 3" in the text style menu (`visualEditor/textStyle`), right after Normal text: a level
 * chosen where it is takes itself off, as Normal text needs.
 */
export const HEADING_STYLES: ChainButton[] = ([1, 2, 3] as const).map((level) => ({
  command: `headings.toggleHeading${level}`,
  title: `Heading ${level}`,
  keywords: [`h${level}`, level === 1 ? 'title' : 'section'],
  order: 10 * level,
  chain: (chain) => chain.toggleHeading({ level }),
  toggled: ({ editor }) => editor.isActive('heading', { level }),
}));
