import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Highlight } from '../document/highlight';
import { sourceToPos } from './projection';

type Layers = Record<string, DecorationSet>;

const key = new PluginKey<Layers>('typst-highlights');

/**
 * Highlights by layer (one per feature, e.g. comments) over the Visual view,
 * given in source offsets. Each layer is replaced as a whole and follows
 * edits until it is set again.
 */
export const highlights = Extension.create({
  name: 'typstHighlights',
  addProseMirrorPlugins() {
    return [
      new Plugin<Layers>({
        key,
        state: {
          init: () => ({}),
          apply(tr, layers) {
            const mapped = tr.docChanged ? mapLayers(layers, tr) : layers;
            const set = tr.getMeta(key) as { layer: string; highlights: readonly Highlight[] } | undefined;
            return set ? { ...mapped, [set.layer]: toDecorations(tr.doc, set.highlights) } : mapped;
          },
        },
        props: {
          decorations: (state) => DecorationSet.create(state.doc, Object.values(key.getState(state) ?? {}).flatMap((set) => set.find())),
        },
      }),
    ];
  },
});

/** Marks `tr` to replace the highlights of `layer`. */
export function setHighlights(tr: Transaction, layer: string, highlights: readonly Highlight[]): Transaction {
  return tr.setMeta(key, { layer, highlights });
}

function mapLayers(layers: Layers, tr: Transaction): Layers {
  return Object.fromEntries(Object.entries(layers).map(([layer, set]) => [layer, set.map(tr.mapping, tr.doc)]));
}

function toDecorations(doc: Node, highlights: readonly Highlight[]): DecorationSet {
  const decorations = highlights.flatMap(({ from, to, className, attributes }) => {
    const start = sourceToPos(doc, from);
    const end = Math.max(start, sourceToPos(doc, to, -1));
    return start < end ? [Decoration.inline(start, end, { class: className, ...attributes })] : [];
  });
  return DecorationSet.create(doc, decorations);
}
