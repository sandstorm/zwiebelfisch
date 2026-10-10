// HeadingNumbers: each heading's number in a gutter right of the text, and the toggle command. See nodes.ts.
import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { headingNumbers, toggleHeadingNumbering } from './heading-numbering';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    headingNumbers: {
      /** Adds `#set heading(numbering: "1.")`, or removes the document's heading numbering. */
      toggleHeadingNumbering: () => ReturnType;
    };
  }
}

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
  addCommands() {
    return {
      toggleHeadingNumbering:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) toggleHeadingNumbering(tr);
          return true;
        },
    };
  },
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
