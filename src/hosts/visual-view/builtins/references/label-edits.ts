// Edits of references and labels as transactions (each one undo step). See references.ts.
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { TextSelection } from '@tiptap/pm/state';


/** Replaces `range` (the typed `@query`) with a reference to `name`; the cursor goes after it. */
export function insertReference(state: EditorState, range: { from: number; to: number }, name: string): Transaction {
  const tr = state.tr.replaceWith(range.from, range.to, state.schema.nodes.reference.create({ target: name }));
  return tr.setSelection(TextSelection.create(tr.doc, range.from + 1)).scrollIntoView();
}

/** Sets (or with null removes) the label of the block at `pos`; a new label goes after one space. */
export function setLabel(state: EditorState, pos: number, name: string | null): Transaction {
  const current = state.doc.nodeAt(pos)?.attrs.label;
  return state.tr.setNodeAttribute(pos, 'label', name === null ? null : { name, gap: current?.gap ?? ' ' });
}

/** Renames the label of the block at `pos` to `name` and, if `withReferences`, every reference to it in this document. */
export function renameLabel(state: EditorState, pos: number, name: string, withReferences: boolean): Transaction {
  const old: string | undefined = state.doc.nodeAt(pos)?.attrs.label?.name;
  const tr = setLabel(state, pos, name);
  if (!withReferences || old === undefined) return tr;
  tr.doc.descendants((node, at) => {
    if (node.type.name === 'reference' && node.attrs.target === old) tr.setNodeAttribute(at, 'target', name);
  });
  return tr;
}
