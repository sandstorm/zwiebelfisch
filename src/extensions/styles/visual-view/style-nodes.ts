// Custom styles in the text: a `styledBlock` around blocks (`#note[..]`) and a `style` mark on text (`#key[..]`).
// See visual-view.ts.
import { Mark, Node } from '@tiptap/core';

/** A style as the Visual view applies it: the function's name and the name people see. */
export interface AppliedStyle {
  name: string;
  label: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    customStyles: {
      /** Puts the selected blocks into paragraph style `style` (`#name[..]`), or switches the style around them. */
      setParagraphStyle: (style: AppliedStyle) => ReturnType;
      /** Takes the selected blocks out of their paragraph style. */
      unsetParagraphStyle: () => ReturnType;
      /** Applies text style `style` (`#name[..]`) to the selection, or removes it where it is on. */
      toggleTextStyle: (style: AppliedStyle) => ReturnType;
    };
  }
}

/**
 * Blocks in a paragraph style: `#note[..]` (or `#callout(kind: ..)[..]`)
 * around them. Their content is edited as usual; the call around it is kept
 * as written (`layout`, owned by the projection), a new one is `#name[..]`.
 * Drawn as a frame with the style's name and the class `typst-style--<name>`.
 */
export const StyledBlock = Node.create({
  name: 'styledBlock',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      name: { default: '', rendered: false },
      // the style's name for people (`label` is the Typst label after a block)
      title: { default: '', rendered: false },
      sep: { default: null, rendered: false },
      layout: { default: null, rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-typst-style]', getAttrs: (element) => ({ name: element.getAttribute('data-typst-style') }) }];
  },
  renderHTML({ node }) {
    return ['div', { class: `typst-visual__style typst-style--${node.attrs.name}`, 'data-typst-style': node.attrs.name, 'data-style-title': node.attrs.title || node.attrs.name }, 0];
  },
  addCommands() {
    return {
      setParagraphStyle:
        ({ name, label }) =>
        ({ editor, commands }) => {
          if (editor.isActive('styledBlock')) return commands.updateAttributes('styledBlock', { name, title: label, layout: null });
          return commands.wrapIn('styledBlock', { name, title: label });
        },
      unsetParagraphStyle:
        () =>
        ({ commands }) =>
          commands.lift('styledBlock'),
    };
  },
});

/**
 * Text in a text style: `#key[..]` around it (`head` keeps a call written
 * with arguments, `#key(..)[`). Drawn with a dotted underline, the style's
 * name as tooltip and the class `typst-style--<name>`. One text style at a time.
 */
export const StyleMark = Mark.create({
  name: 'style',
  // outside bold and italic (100) where it covers the same text (`#key[*x*]`), inside links (120) and notes
  priority: 110,
  // typing at its end continues the style, as with bold
  addAttributes() {
    return {
      name: { default: '', rendered: false },
      title: { default: '', rendered: false },
      head: { default: null, rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-typst-style]', getAttrs: (element) => ({ name: element.getAttribute('data-typst-style') }) }];
  },
  renderHTML({ mark }) {
    const title = mark.attrs.title || mark.attrs.name;
    return ['span', { class: `typst-visual__style-text typst-style--${mark.attrs.name}`, 'data-typst-style': mark.attrs.name, title }, 0];
  },
  addCommands() {
    return {
      toggleTextStyle:
        ({ name, label }) =>
        ({ editor, commands }) =>
          editor.isActive('style', { name }) ? commands.unsetMark('style') : commands.setMark('style', { name, title: label, head: null }),
    };
  },
});
