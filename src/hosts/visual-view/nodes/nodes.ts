// The Visual view's schema: the host's own nodes (document, paragraph, text, line breaks, raw Typst), the
// contributed specs' extensions, and what the host adds to every contributed node (source anchors, labels, raw box
// node views). See ARCHITECTURE.md, "VisualView".
import { Extension, Mark, Node, type AnyExtension, type Attribute } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import { DOMSerializer, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView, NodeView, NodeViewConstructor } from '@tiptap/pm/view';
import { attachGrammar, type MarkGrammar, type NodeGrammar } from '../../projection/projection';
import { starterKitPart } from '../visual-view';
import { RawBoxNavigation, rawBoxView } from './raw-box';

/**
 * The Tiptap extensions of a Visual view whose schema holds `nodes` and
 * `marks` besides the host's own: the specs' extensions in registration
 * order, between the host's base (paragraph, text, history) and its raw
 * Typst nodes. Each spec's node type also gets what the spec asks the host
 * for (see `NodeGrammar`):
 *
 * - its source-anchoring `attributes` (never rendered; part of node
 *   equality, so re-projections compare exactly; `src`: the node's original
 *   Typst; `sep`: the whitespace to its next sibling, `null` on last children
 *   and on nodes made in the editor (a default separator is printed));
 * - `label` (`{ name, gap }` or null) if `labelled`: the label after the
 *   block (`= Intro <intro>`), printed after it;
 * - with `keepsDom`, a node view keeping the block's DOM while a new version
 *   renders the same: a block whose anchors change (as every re-projected
 *   block's `src` does after an edit from elsewhere) keeps its DOM, so what is
 *   inside, like an open note editor, survives;
 * - with `box: 'code'`, the raw box node view (`raw-box.ts`).
 */
export function editorExtensions(nodes: readonly NodeGrammar[], marks: readonly MarkGrammar[]): AnyExtension[] {
  const specs = [...HOST_NODES, ...nodes];
  const contributed = [...nodes, ...marks].map((spec) => spec.extension).filter((extension) => extension !== undefined);
  return [HostBase, ...new Set(contributed), TypstDocument, RawBlock, RawInline, RawBoxNavigation, SoftBreak, TypstSource, sourceAnchors(specs)];
}

/** Makes `nodes` and `marks` (and the host's own specs) what `project` and `print` use for documents of `schema`. */
export function attachSpecs(schema: Schema, nodes: readonly NodeGrammar[], marks: readonly MarkGrammar[]): void {
  attachGrammar(schema, [...HOST_NODES, ...nodes], marks);
}

/** The host's base: paragraphs, text, line breaks (`\`), history, drop and gap cursors. */
const HostBase = starterKitPart('typstBase', { paragraph: {}, text: undefined, hardBreak: {}, undoRedo: {}, dropcursor: {}, gapcursor: undefined });

const ANCHORS: Record<string, Attribute> = {
  src: { default: null, rendered: false, keepOnSplit: false },
  sep: { default: null, rendered: false },
};

/** The host's own nodes, as the projection and the schema see them. */
const HOST_NODES: NodeGrammar[] = [
  { name: 'paragraph', attributes: ANCHORS, keepsDom: true, labelled: true },
  { name: 'hardBreak', attributes: { src: { default: '\\\n', rendered: false, keepOnSplit: false } } },
  { name: 'rawBlock', labelled: true, box: 'code' },
  { name: 'rawInline', box: 'code' },
];

/** What the specs ask the host for: source anchors and labels (global attributes), kept DOM and raw box node views. */
function sourceAnchors(specs: readonly NodeGrammar[]): AnyExtension {
  return Extension.create({
    name: 'typstSourceAnchors',
    addProseMirrorPlugins() {
      const editor = this.editor;
      const views: Record<string, NodeViewConstructor> = {};
      for (const spec of specs) {
        if (spec.keepsDom) views[spec.name] = keepWhileRenderedSame;
        if (spec.box === 'code') views[spec.name] = (node, _view, getPos, decorations) => rawBoxView(node, editor, getPos, decorations);
      }
      return [new Plugin({ props: { nodeViews: views } })];
    },
    addGlobalAttributes() {
      const label = { label: { default: null, rendered: false, keepOnSplit: false } };
      return [
        ...specs.filter((spec) => spec.attributes).map((spec) => ({ types: [spec.name], attributes: { ...spec.attributes } })),
        { types: specs.filter((spec) => spec.labelled).map((spec) => spec.name), attributes: label },
      ];
    },
  });
}

/**
 * The block as its schema renders it, kept (and its content updated in place)
 * while a new version renders the same. ProseMirror would rebuild it, and
 * everything inside, on any attribute change.
 */
function keepWhileRenderedSame(initial: PMNode, view: EditorView): NodeView {
  let node = initial;
  const render = (n: PMNode) => n.type.spec.toDOM!(n);
  const { dom, contentDOM } = DOMSerializer.renderSpec(view.dom.ownerDocument, render(node));
  return {
    dom,
    contentDOM,
    update: (next) => {
      if (next.type !== node.type || JSON.stringify(render(next)) !== JSON.stringify(render(node))) return false;
      node = next;
      return true;
    },
  };
}

/** The document: `lead` / `trail` are the source before the first block and after the last one. */
const TypstDocument = Document.extend({
  addAttributes() {
    return { lead: { default: '', rendered: false }, trail: { default: '\n', rendered: false } };
  },
});

/**
 * Block-level Typst no spec models (`#set`, `#let`, display math, …), kept
 * verbatim and editable as code in a raw box.
 */
const RawBlock = Node.create({
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
const RawInline = Node.create({
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
const SoftBreak = Node.create({
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
const TypstSource = Mark.create({
  name: 'typstSource',
  inclusive: false,
  addAttributes() {
    return { src: { rendered: false }, text: { rendered: false } };
  },
  renderHTML() {
    return ['span', 0];
  },
});
