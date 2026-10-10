import { Schema } from 'prosemirror-model';

/**
 * ProseMirror schema of the Visual view.
 *
 * Source-anchoring attributes (part of node equality, so re-projections are
 * compared exactly):
 * - `src`: the node's original Typst source.
 * - `sep`: the whitespace between this node and its next sibling; `null` on
 *   last children (the container owns trailing whitespace) and on nodes
 *   created in the editor (a default separator is printed).
 */
export const schema = new Schema({
  nodes: {
    doc: {
      content: 'block+',
      attrs: { lead: { default: '' }, trail: { default: '\n' } },
    },
    paragraph: {
      group: 'block',
      content: 'inline*',
      attrs: { src: { default: null }, sep: { default: null } },
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    },
    heading: {
      group: 'block',
      content: 'inline*',
      defining: true,
      attrs: { level: { default: 1 }, src: { default: null }, sep: { default: null } },
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level } })),
      toDOM: (node) => [`h${Math.min(node.attrs.level, 6)}`, 0],
    },
    raw_block: {
      group: 'block',
      atom: true,
      selectable: true,
      attrs: { src: { default: '' }, sep: { default: null } },
      toDOM: (node) => ['pre', { class: 'typst-visual__raw-block', 'data-src': node.attrs.src }, node.attrs.src],
    },
    bullet_list: {
      group: 'block',
      content: 'list_item+',
      attrs: { sep: { default: null } },
      parseDOM: [{ tag: 'ul' }],
      toDOM: () => ['ul', 0],
    },
    ordered_list: {
      group: 'block',
      content: 'list_item+',
      attrs: { sep: { default: null } },
      parseDOM: [{ tag: 'ol' }],
      toDOM: () => ['ol', 0],
    },
    list_item: {
      content: '(paragraph | raw_block)',
      defining: true,
      attrs: { marker: { default: '-' }, src: { default: null }, sep: { default: null } },
      parseDOM: [{ tag: 'li' }],
      toDOM: () => ['li', 0],
    },
    text: { group: 'inline' },
    raw_inline: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { src: { default: '' } },
      toDOM: (node) => ['code', { class: 'typst-visual__raw-inline' }, node.attrs.src],
    },
    soft_break: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { src: { default: '\n' } },
      toDOM: () => ['span', { class: 'typst-visual__soft-break' }, ' '],
    },
    hard_break: {
      group: 'inline',
      inline: true,
      atom: true,
      attrs: { src: { default: '\\\n' } },
      parseDOM: [{ tag: 'br' }],
      toDOM: () => ['br'],
    },
  },
  marks: {
    strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: () => ['strong', 0] },
    emph: { parseDOM: [{ tag: 'em' }, { tag: 'i' }], toDOM: () => ['em', 0] },
    /**
     * Text that was written differently in the source (an escape like `\*`
     * or a shorthand like `--`). Printed as `src` while the text still equals
     * `text`; never extends to newly typed text.
     */
    source: {
      inclusive: false,
      attrs: { src: {}, text: {} },
      toDOM: () => ['span', { class: 'typst-visual__source' }, 0],
    },
  },
});
