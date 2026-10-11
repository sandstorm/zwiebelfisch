// Heading numbers in the Visual view: each heading's number in a gutter right of the text. See visual-view.ts.
import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { HeadingCounter } from '../model/heading-numbering';

const key = new PluginKey<DecorationSet>('typstHeadingNumbers');

/**
 * Shows each heading's number, as the document's `#set heading(numbering:
 * ..)` makes Typst number it, in a gutter right of the text: a node
 * decoration (`data-heading-number`, drawn by CSS), so it is not part of the
 * editable content. The editor gets `typst-visual--numbered` while any
 * heading shows a number, to make room for the gutter.
 */
export const HeadingNumbers = Extension.create({
  name: 'typstHeadingNumbers',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: (_config, state) => numberDecorations(state.doc),
          apply: (tr, decorations) => (tr.docChanged ? numberDecorations(tr.doc) : decorations),
        },
        props: {
          decorations: (state) => key.getState(state),
          attributes: (state): Record<string, string> =>
            key.getState(state)!.find().length > 0 ? { class: 'typst-visual--numbered' } : {},
        },
      }),
    ];
  },
});

function numberDecorations(doc: Node): DecorationSet {
  const decorations = headingNumbers(doc).map(({ pos, number }) =>
    Decoration.node(pos, pos + doc.nodeAt(pos)!.nodeSize, { class: 'typst-visual__numbered-heading', 'data-heading-number': number }),
  );
  return DecorationSet.create(doc, decorations);
}

/**
 * The number of each heading in `doc` that shows one, by the heading's
 * position: only rules in top-level raw blocks count; headings inside raw
 * boxes are not seen (the preview shows the real numbers).
 */
function headingNumbers(doc: Node): { pos: number; number: string }[] {
  const result: { pos: number; number: string }[] = [];
  const counter = new HeadingCounter();
  doc.descendants((node, pos, parent) => {
    if (node.type.name === 'rawBlock' && parent === doc) counter.readRules(node.attrs.src);
    const number = node.type.name === 'heading' ? counter.count(node.attrs.level) : null;
    if (number !== null) result.push({ pos, number });
    return !node.isTextblock && !node.isAtom;
  });
  return result;
}
