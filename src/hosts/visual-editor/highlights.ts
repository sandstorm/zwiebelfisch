// Highlights (other users' selections, diagnostics) as ProseMirror decorations over source ranges. See VisualEditor in
// visual-editor.ts.
import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { type EditorState, Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { SourceHighlight } from './visual-editor';
import { sourceToPos } from '../prosemirror-typst/prosemirror-typst';

/**
 * Highlights by layer (one per provider, e.g. other users' selections) over the Visual editor,
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
            const set = tr.getMeta(key) as { layer: string; highlights: readonly SourceHighlight[] } | undefined;
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
export function setHighlights(tr: Transaction, layer: string, highlights: readonly SourceHighlight[]): Transaction {
  return tr.setMeta(key, { layer, highlights });
}

/** Whether `state` draws highlights of `layer`. */
export function hasHighlights(state: EditorState, layer: string): boolean {
  return (key.getState(state)?.[layer]?.find().length ?? 0) > 0;
}

type Layers = Record<string, DecorationSet>;

const key = new PluginKey<Layers>('typst-highlights');

function mapLayers(layers: Layers, tr: Transaction): Layers {
  return Object.fromEntries(Object.entries(layers).map(([layer, set]) => [layer, set.map(tr.mapping, tr.doc)]));
}

function toDecorations(doc: Node, highlights: readonly SourceHighlight[]): DecorationSet {
  return DecorationSet.create(doc, highlights.flatMap((highlight) => rangeDecorations(doc, highlight)));
}

/**
 * The decorations drawing source range `from..to` with `className` and
 * `attributes`: inline over the text, plus the block atoms (raw code boxes)
 * in range, which inline decorations skip.
 */
function rangeDecorations(doc: Node, { from, to, className, attributes }: SourceHighlight): Decoration[] {
  const start = sourceToPos(doc, from);
  const end = Math.max(start, sourceToPos(doc, to, -1));
  if (start >= end) return [];
  const attrs = { class: className, ...attributes };
  return [Decoration.inline(start, end, attrs), ...blockAtoms(doc, start, end).map((pos) => Decoration.node(pos, pos + doc.nodeAt(pos)!.nodeSize, attrs))];
}

/** Positions of block atoms (raw code boxes) overlapping `from..to`: inline decorations skip them. */
function blockAtoms(doc: Node, from: number, to: number): number[] {
  const found: number[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isBlock && node.isAtom) found.push(pos);
    return !node.isAtom;
  });
  return found;
}
