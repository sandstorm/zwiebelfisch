// The Visual view's editor extensions over the projection's schema: what the view adds to every node type whose spec
// asks for it (kept DOM, raw box node views, the own-pseudo-elements mark) and the raw boxes' keyboard navigation.
// See ARCHITECTURE.md, "VisualView".
import { Extension, type AnyExtension } from '@tiptap/core';
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView, type NodeView, type NodeViewConstructor } from '@tiptap/pm/view';
import { BASE_NODES, documentExtensions, type MarkGrammar, type NodeGrammar } from '../../projection/projection';
import type { TypstNodeSpec } from '../visual-view';
import { RawBoxNavigation, rawBoxViews, type Boxes } from './raw-box';

/**
 * The Tiptap extensions of a Visual view whose schema holds `nodes` and `marks`
 * (see `documentExtensions`), and for each node type (the schema's own and the
 * specs'):
 *
 * - with `keepsDom`, a node view keeping the block's DOM while a new version
 *   renders the same: a block whose anchors change (as every re-projected
 *   block's `src` does after an edit from elsewhere) keeps its DOM, so what is
 *   inside, like an open note editor, survives;
 * - with `box: 'code'`, the raw box node view (`raw-box.ts`) with what `boxes` contribute;
 * - with `ownsPseudoElements`, `data-typst-pseudo="own"` on its DOM.
 */
export function editorExtensions(nodes: readonly TypstNodeSpec[], marks: readonly MarkGrammar[], boxes: Boxes): AnyExtension[] {
  return [...documentExtensions(nodes, marks), RawBoxNavigation, nodeViews([...BASE_NODES, ...nodes], boxes)];
}

/** Kept DOM, raw box node views and the own-pseudo-elements mark, as the specs ask. */
function nodeViews(specs: readonly (NodeGrammar & Pick<TypstNodeSpec, 'ownsPseudoElements'>)[], boxes: Boxes): AnyExtension {
  return Extension.create({
    name: 'typstNodeViews',
    addProseMirrorPlugins() {
      const rawBox = rawBoxViews(this.editor, boxes);
      const views: Record<string, NodeViewConstructor> = {};
      for (const spec of specs) {
        if (spec.keepsDom) views[spec.name] = keepWhileRenderedSame;
        if (spec.box === 'code') views[spec.name] = rawBox;
      }
      const own = new Set(specs.filter((spec) => spec.ownsPseudoElements).map((spec) => spec.name));
      return [new Plugin({ props: { nodeViews: views } }), ...(own.size > 0 ? [ownPseudoElements(own)] : [])];
    },
  });
}

/** `data-typst-pseudo="own"` on the DOM of every node of the `types` (as a node decoration: whatever their `renderHTML`). */
function ownPseudoElements(types: ReadonlySet<string>): Plugin<DecorationSet> {
  const decorate = (doc: PMNode) => {
    const decorations: Decoration[] = [];
    doc.descendants((node, pos) => {
      if (types.has(node.type.name)) decorations.push(Decoration.node(pos, pos + node.nodeSize, { 'data-typst-pseudo': 'own' }));
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
