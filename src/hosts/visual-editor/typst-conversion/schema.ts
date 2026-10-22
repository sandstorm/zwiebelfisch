// The Tiptap nodes and marks of the minimum schema besides Tiptap's paragraph and text. See documentExtensions in
// typst-conversion.ts.
import { Extension, Mark, Node, type AnyExtension } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import type { DocumentNodeSpec } from './typst-conversion';

/**
 * The extension giving Tiptap's paragraphs their source anchors (`src`, their original Typst; a
 * paragraph's `sep`, the whitespace to its next sibling), and the `labelled` node types of `specs` their `label`.
 * A paragraph made by a split in the editor has no anchors.
 */
export function sourceAnchors(specs: readonly DocumentNodeSpec[]): AnyExtension {
  return Extension.create({
    name: 'typstSourceAnchors',
    addGlobalAttributes() {
      const label = { label: { default: null, rendered: false, keepOnSplit: false } };
      return [
        { types: ['paragraph'], attributes: { src: { default: null, rendered: false, keepOnSplit: false }, sep: { default: null, rendered: false, keepOnSplit: false } } },
        { types: specs.filter((spec) => spec.typst?.labelled).map((spec) => spec.name), attributes: label },
      ];
    },
  });
}

/** The document: `lead` / `trail` are the source before the first block and after the last one. */
export const TypstDocument = Document.extend({
  addAttributes() {
    return { lead: { default: '', rendered: false }, trail: { default: '\n', rendered: false } };
  },
});

/** `src` carried as `data-src` in HTML, so ProseMirror's default HTML clipboard keeps a raw box's Typst. */
const sourceInHTML = {
  default: '',
  parseHTML: (element: HTMLElement) => element.getAttribute('data-src') ?? '',
  renderHTML: (attrs: Record<string, unknown>) => ({ 'data-src': attrs.src }),
};

/**
 * Block-level Typst no spec models (`#set`, `#let`, display math, …), kept
 * verbatim and editable as code in a raw box. In HTML a `<pre data-src>`, read before a code block's `<pre>`.
 */
export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { src: sourceInHTML, sep: { default: null, rendered: false } };
  },
  parseHTML() {
    return [{ tag: 'pre[data-src]', priority: 60 }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['pre', { ...HTMLAttributes, class: 'zwf-visual__raw-block' }, node.attrs.src];
  },
});

/**
 * Inline Typst no spec models (`#func[..]`, `$x$`, `<label>`, …), kept verbatim and editable as code.
 * `code`: `src` is written in code, without `#` (a table cell that is an expression, like `ms(18)`).
 * In HTML a `<code data-src>` (`data-code` when `code`), read before the code mark's `<code>`.
 */
export const RawInline = Node.create({
  name: 'rawInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      src: sourceInHTML,
      code: {
        default: false,
        parseHTML: (element: HTMLElement) => element.hasAttribute('data-code'),
        renderHTML: (attrs: Record<string, unknown>) => (attrs.code ? { 'data-code': '' } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'code[data-src]', priority: 60 }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['code', { ...HTMLAttributes, class: 'zwf-visual__raw-inline' }, node.attrs.src];
  },
});

/** A newline inside a paragraph: renders as a space (as in Typst) but keeps the source's line structure. */
export const SoftBreak = Node.create({
  name: 'softBreak',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return { src: { default: '\n', rendered: false } };
  },
  renderHTML() {
    return ['span', { class: 'zwf-visual__soft-break' }, ' '];
  },
});

/**
 * Text written differently in the source (an escape like `\*`, a shorthand
 * like `--`). Printed as `src` while the text still equals `text`; never
 * extends to newly typed text.
 */
export const TypstSource = Mark.create({
  name: 'typstSource',
  inclusive: false,
  addAttributes() {
    return { src: { rendered: false }, text: { rendered: false } };
  },
  renderHTML() {
    return ['span', 0];
  },
});
