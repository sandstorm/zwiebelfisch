// The Visual view's editor extensions over the projection's schema: what the view adds to every node type whose spec
// asks for it (kept DOM, raw box node views) and the raw boxes' keyboard navigation. See ARCHITECTURE.md, "VisualView".
import { Extension, type AnyExtension } from '@tiptap/core';
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView, NodeView, NodeViewConstructor } from '@tiptap/pm/view';
import { BASE_NODES, documentExtensions, type MarkGrammar, type NodeGrammar } from '../../projection/projection';
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
 * - with `box: 'code'`, the raw box node view (`raw-box.ts`) with what `boxes` contribute.
 */
export function editorExtensions(nodes: readonly NodeGrammar[], marks: readonly MarkGrammar[], boxes: Boxes): AnyExtension[] {
  return [...documentExtensions(nodes, marks), RawBoxNavigation, nodeViews([...BASE_NODES, ...nodes], boxes)];
}

/** Kept DOM and raw box node views, as the specs ask. */
function nodeViews(specs: readonly NodeGrammar[], boxes: Boxes): AnyExtension {
  return Extension.create({
    name: 'typstNodeViews',
    addProseMirrorPlugins() {
      const rawBox = rawBoxViews(this.editor, boxes);
      const views: Record<string, NodeViewConstructor> = {};
      for (const spec of specs) {
        if (spec.keepsDom) views[spec.name] = keepWhileRenderedSame;
        if (spec.box === 'code') views[spec.name] = rawBox;
      }
      return [new Plugin({ props: { nodeViews: views } })];
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
