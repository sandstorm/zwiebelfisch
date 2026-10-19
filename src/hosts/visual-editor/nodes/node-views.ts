// See VisualEditor in ../visual-editor-impl.ts.
import { Extension, type AnyExtension } from '@tiptap/core';
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView, type NodeView, type NodeViewConstructor } from '@tiptap/pm/view';
import { documentExtensions, type TypstMarkSpec } from '../../prosemirror-typst/prosemirror-typst';
import type { TypstNodeSpec } from '../visual-editor';
import { RawBoxNavigation, rawBoxViews, type RawBoxes } from './raw-box';

/**
 * The Tiptap extensions of a Visual editor whose schema holds `nodes` and `marks`, with the node view each node type's
 * `view` asks for:
 * - `keepsDom`: the block keeps its DOM while a new version renders the same, so what is inside (an open note editor)
 *   survives an edit from elsewhere
 * - `box: 'code'`: a raw box with what `boxes` contribute
 * - `ownsPseudoElements`: `data-zwf-pseudo="own"` on its DOM
 *
 * And the raw boxes' keyboard navigation.
 */
export function editorExtensions(nodes: readonly TypstNodeSpec[], marks: readonly TypstMarkSpec[], boxes: RawBoxes): AnyExtension[] {
  return [...documentExtensions(nodes, marks), RawBoxNavigation, nodeViews(boxes)];
}

/** The `view` of every node type, the base's and `nodes`', merged by name (a later spec's fields win). */
export function nodeViewSpecs(nodes: readonly TypstNodeSpec[]): Map<string, NonNullable<TypstNodeSpec['view']>> {
  const views = new Map<string, NonNullable<TypstNodeSpec['view']>>();
  for (const { name, view } of [...BASE_VIEWS, ...nodes]) views.set(name, { ...views.get(name), ...view });
  return views;
}

/** Kept DOM, raw box node views and the own-pseudo-elements mark, as the specs' `view` asks. */
function nodeViews(boxes: RawBoxes): AnyExtension {
  return Extension.create({
    name: 'typstNodeViews',
    addProseMirrorPlugins() {
      const rawBox = rawBoxViews(this.editor, boxes);
      const nodeViews: Record<string, NodeViewConstructor> = {};
      const own = new Set<string>();
      for (const [name, view] of boxes.nodeViews) {
        if (view.keepsDom) nodeViews[name] = keepWhileRenderedSame;
        if (view.box === 'code') nodeViews[name] = rawBox;
        if (view.ownsPseudoElements) own.add(name);
      }
      return [new Plugin({ props: { nodeViews } }), ...(own.size > 0 ? [ownPseudoElements(own)] : [])];
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

/** `data-zwf-pseudo="own"` on the DOM of every node of the `types` (as a node decoration: whatever their `renderHTML`). */
function ownPseudoElements(types: ReadonlySet<string>): Plugin<DecorationSet> {
  const decorate = (doc: PMNode) => {
    const decorations: Decoration[] = [];
    doc.descendants((node, pos) => {
      if (types.has(node.type.name)) decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-zwf-pseudo': 'own' }));
    });
    return DecorationSet.create(doc, decorations);
  };
  return new Plugin<DecorationSet>({
    state: { init: (_config, state) => decorate(state.doc), apply: (tr, old) => (tr.docChanged ? decorate(tr.doc) : old) },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });
}

/** What the minimum schema's own nodes get: paragraphs keep their DOM, raw Typst shows in raw boxes. */
const BASE_VIEWS: readonly TypstNodeSpec[] = [
  { name: 'paragraph', view: { keepsDom: true } },
  { name: 'rawBlock', view: { box: 'code' } },
  { name: 'rawInline', view: { box: 'code' } },
];
