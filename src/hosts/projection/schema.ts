// The Tiptap nodes and marks of the minimum schema besides StarterKit's parts: the document with its lead and
// trail, raw Typst (block and inline), soft breaks, the typstSource mark; and the extension giving the specs' node
// types their source anchors and labels. See projection.ts (`documentExtensions`) and ARCHITECTURE.md, "VisualView".
import { Extension, Mark, Node, type AnyExtension, type Attribute } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import type { NodeGrammar } from './projection';

/** Source anchors of a node made from the source: `src`, its original Typst; `sep`, the whitespace to its next sibling. */
export const ANCHORS: Record<string, Attribute> = {
  src: { default: null, rendered: false, keepOnSplit: false },
  sep: { default: null, rendered: false },
};

/** What the specs ask for in the schema: their `attributes` and, if `labelled`, `label` (global attributes). */
export function sourceAnchors(specs: readonly NodeGrammar[]): AnyExtension {
  return Extension.create({
    name: 'typstSourceAnchors',
    addGlobalAttributes() {
      const label = { label: { default: null, rendered: false, keepOnSplit: false } };
      return [
        ...specs.filter((spec) => spec.attributes).map((spec) => ({ types: [spec.name], attributes: { ...spec.attributes } })),
        { types: specs.filter((spec) => spec.labelled).map((spec) => spec.name), attributes: label },
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
