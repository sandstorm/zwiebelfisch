import { Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      /** Inserts `#pagebreak()` as a block of its own at the selection. */
      setPageBreak: () => ReturnType;
    };
  }
}

/**
 * A standalone `#pagebreak(..)` call (see `callAtomType`), shown as a
 * labelled dashed divider. Its source, arguments included, is kept verbatim.
 */
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return { src: { default: '#pagebreak()', rendered: false }, sep: { default: null, rendered: false } };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="page-break"]' }];
  },
  renderHTML({ node }) {
    const weak = /\bweak\s*:\s*true\b/.test(node.attrs.src);
    return ['div', { 'data-type': 'page-break', class: 'typst-visual__page-break', title: node.attrs.src }, ['span', weak ? 'Page break (weak)' : 'Page break']];
  },
  addCommands() {
    return { setPageBreak: () => ({ commands }) => commands.insertContent({ type: this.name }) };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.setPageBreak() };
  },
});
