// The page break: `#pagebreak()` as a labelled divider, "Insert page break" and Mod+Enter. See ../page-layout.ts.
import { Node } from '@tiptap/core';
import { hasOnlyArguments, withHash } from '../../../core/typst-syntax/typst-syntax';
import { svg, type Action, type TypstNodeSpec } from '../../../hosts/visual-view/visual-view';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      /** Inserts `#pagebreak()` as a block of its own at the selection. */
      setPageBreak: () => ReturnType;
    };
  }
}

const PageBreak = Node.create({
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

/**
 * A standalone `#pagebreak(..)` call (any arguments), shown as a labelled
 * dashed divider (a fixed widget, not editable as code). Its source,
 * arguments included, is kept verbatim.
 */
export const PAGE_BREAK: TypstNodeSpec = {
  name: 'pageBreak',
  extension: PageBreak,
  labelled: true,
  // the dashed lines
  ownsPseudoElements: true,
  blockCalls: { pagebreak: (p, call, sep) => (hasOnlyArguments(call) ? p.schema.nodes.pageBreak.create({ src: p.text(withHash(call)), sep }) : null) },
};

const ICON = svg('<path d="M6 3v5h12V3"/><path d="M6 21v-5h12v5"/><path d="M3 12h2M8 12h2M14 12h2M19 12h2"/>');

/** "Insert page break" in the Insert menu (also Mod+Enter in the text). */
export const INSERT_PAGE_BREAK: Action = { label: 'Insert page break', shortcut: 'Mod+Enter', icon: ICON, run: (c) => c.setPageBreak() };
