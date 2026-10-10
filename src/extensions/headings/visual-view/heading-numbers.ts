// Heading numbers in the Visual view: each heading's number in a gutter right of the text, and the command that
// switches numbering on or off. See visual-view.ts.
import { Extension } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { HEADING_NUMBERING_RULE, HeadingCounter, numbersHeadings, withoutHeadingNumbering } from '../model/heading-numbering';

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

/**
 * The number of each heading in `doc` that shows one, by the heading's
 * position: only rules in top-level raw blocks count; headings inside raw
 * boxes are not seen (the preview shows the real numbers).
 */
export function headingNumbers(doc: Node): { pos: number; number: string }[] {
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

/** Whether a top-level rule numbers headings. */
export function hasHeadingNumbering(doc: Node): boolean {
  let numbered = false;
  doc.forEach((block) => {
    if (block.type.name === 'rawBlock') numbered ||= numbersHeadings(block.attrs.src);
  });
  return numbered;
}

/**
 * Numbered headings → removes the numbering from every top-level set rule
 * (a block left empty is deleted); otherwise adds `HEADING_NUMBERING_RULE`
 * as a block after the raw blocks the document starts with.
 */
export function toggleHeadingNumbering(tr: Transaction): void {
  if (hasHeadingNumbering(tr.doc)) removeNumbering(tr);
  else addNumbering(tr);
}

function addNumbering(tr: Transaction): void {
  let pos = 0;
  for (let i = 0; i < tr.doc.childCount && tr.doc.child(i).type.name === 'rawBlock'; i++) pos += tr.doc.child(i).nodeSize;
  tr.insert(pos, tr.doc.type.schema.nodes.rawBlock.create({ src: HEADING_NUMBERING_RULE }));
}

function removeNumbering(tr: Transaction): void {
  const blocks: { block: Node; pos: number }[] = [];
  tr.doc.forEach((block, pos) => {
    if (block.type.name === 'rawBlock') blocks.push({ block, pos });
  });
  for (const { block, pos } of blocks.reverse()) {
    const src = withoutHeadingNumbering(block.attrs.src);
    if (src === block.attrs.src) continue;
    if (src.trim() === '') tr.delete(pos, pos + block.nodeSize);
    else tr.setNodeMarkup(pos, undefined, { ...block.attrs, src });
  }
}
