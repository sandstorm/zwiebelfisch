// The Tiptap nodes and marks of the minimum schema besides StarterKit's parts: the document with its lead and
// trail, raw Typst (block and inline), soft breaks, the typstSource mark; and the extension giving StarterKit's
// paragraphs and line breaks their source anchors and labelled specs' node types their `label`. See prosemirror-typst.ts
// (`documentExtensions`) and docs/30_architecture/03_prosemirror-typst.typ.
import { Extension, Mark, Node, type AnyExtension } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import type { DocumentNodeSpec } from './prosemirror-typst';

/**
 * Source anchors of the base's paragraphs (`src`, its original Typst; `sep`, the whitespace to its next sibling) and
 * line breaks (`src`), and `label` on the node types of `specs` that are `labelled` (global attributes).
 */
export function sourceAnchors(specs: readonly DocumentNodeSpec[]): AnyExtension {
  return Extension.create({
    name: 'typstSourceAnchors',
    addGlobalAttributes() {
      const label = { label: { default: null, rendered: false, keepOnSplit: false } };
      return [
        { types: ['paragraph'], attributes: { src: { default: null, rendered: false, keepOnSplit: false }, sep: { default: null, rendered: false } } },
        { types: ['hardBreak'], attributes: { src: { default: '\\\n', rendered: false, keepOnSplit: false } } },
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

/**
 * Block-level Typst no spec models (`#set`, `#let`, display math, …), kept
 * verbatim and editable as code in a raw box.
 */
export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,
  addAttributes() {
    return { src: { default: '', rendered: false }, sep: { default: null, rendered: false } };
  },
  renderHTML({ node }) {
    return ['pre', { class: 'typst-visual__raw-block' }, node.attrs.src];
  },
});

/**
 * Inline Typst no spec models (`#func[..]`, `$x$`, `<label>`, …), kept verbatim and editable as code.
 * `code`: `src` is written in code, without `#` (a table cell that is an expression, like `ms(18)`).
 */
export const RawInline = Node.create({
  name: 'rawInline',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { src: { default: '', rendered: false }, code: { default: false, rendered: false } };
  },
  renderHTML({ node }) {
    return ['code', { class: 'typst-visual__raw-inline' }, node.attrs.src];
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
    return ['span', { class: 'typst-visual__soft-break' }, ' '];
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
