// The `reference` node: `@key` / `@key[supplement]` as an inline chip. See labels in ../labels.ts.
import { Node } from '@tiptap/core';

/**
 * A reference to a label (`@method`, `@fig:compile-times`, `@key[Chapter]`):
 * an inline atom shown as a chip with the label's name. `target` is the label,
 * `supplement` the `[..]` after it as written (null if none); the serializer
 * prints both back. What the label is (a hint like "Section · Method", or
 * that there is no such label) is added by `referenceHints`.
 */
export const Reference = Node.create({
  name: 'reference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { target: { default: '', rendered: false }, supplement: { default: null, rendered: false } };
  },
  renderHTML({ node }) {
    const supplement: string | null = node.attrs.supplement;
    const name = ['span', { class: 'typst-labels__ref-name' }, node.attrs.target];
    const attrs = { class: 'typst-labels__ref', 'data-testid': 'typst-ref', 'data-target': node.attrs.target };
    if (supplement === null) return ['span', attrs, name];
    return ['span', attrs, name, ['span', { class: 'typst-labels__ref-supplement' }, supplement.slice(1, -1)]];
  },
  renderText({ node }) {
    return `@${node.attrs.target}`;
  },
});
