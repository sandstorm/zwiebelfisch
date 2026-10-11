// Custom styles in the text: a `styledBlock` around blocks (`#note[..]`) and a `style` mark on text (`#key[..]`).
// See visual-editor.ts.
import { Mark, Node } from '@tiptap/core';

/** A style as the Visual editor applies it: the function's name and the name people see. */
export interface AppliedStyle {
  name: string;
  label: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    customStyles: {
      /** Puts the selected blocks into block style `style` (`#name[..]`), or switches the style around them. */
      setBlockStyle: (style: AppliedStyle) => ReturnType;
      /** Takes the selected blocks out of their block style. */
      unsetBlockStyle: () => ReturnType;
      /** Applies inline style `style` (`#name[..]`) to the selection, or removes it where it is on. */
      toggleInlineStyle: (style: AppliedStyle) => ReturnType;
    };
  }
}

/**
 * Blocks in a block style: `#note[..]` (or `#callout(kind: ..)[..]`)
 * around them. Their content is edited as usual; the call around it is kept
 * as written (`layout`, owned by the serializer), a new one is `#name[..]`.
 * Drawn as a frame with the style's name and the class `typst-styles--<name>`.
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
    return ['div', { class: `typst-styles__block typst-styles--${node.attrs.name}`, 'data-typst-style': node.attrs.name, 'data-style-title': node.attrs.title || node.attrs.name }, 0];
  },
  addCommands() {
    return {
      setBlockStyle:
        ({ name, label }) =>
        ({ editor, commands }) => {
          if (editor.isActive('styledBlock')) return commands.updateAttributes('styledBlock', { name, title: label, layout: null });
          return commands.wrapIn('styledBlock', { name, title: label });
        },
      unsetBlockStyle:
        () =>
        ({ commands }) =>
          commands.lift('styledBlock'),
    };
  },
});

/**
 * Text in an inline style: `#key[..]` around it (`head` keeps a call written
 * with arguments, `#key(..)[`). Drawn with a dotted underline, the style's
 * name as tooltip and the class `typst-styles--<name>`. One inline style at a time.
 */
export const TypstStyleMark = Mark.create({
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
    return ['span', { class: `typst-styles__inline typst-styles--${mark.attrs.name}`, 'data-typst-style': mark.attrs.name, title }, 0];
  },
  addCommands() {
    return {
      toggleInlineStyle:
        ({ name, label }) =>
        ({ editor, commands }) =>
          editor.isActive('style', { name }) ? commands.unsetMark('style') : commands.setMark('style', { name, title: label, head: null }),
    };
  },
});
