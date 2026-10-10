// Makes sure a document with task lists has cheq's import and `#show: checklist` exactly once (the decision is the
// model's calculateChecklistPreambleChange). See task-lists.ts.
import type { Node } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { calculateChecklistPreambleChange } from '../model/checklist-preamble';

/**
 * Adds what is missing of cheq's import and show rule to the top-level raw
 * blocks of `tr.doc` (the only place they apply to the whole document): both
 * as one block at the top, the show rule right after an existing import, or
 * the import at the top before an existing show rule.
 */
export function ensureChecklistPreamble(tr: Transaction): void {
  const blocks: { code: string; end: number }[] = [];
  tr.doc.forEach((block, offset) => {
    if (block.type.name === 'rawBlock') blocks.push({ code: block.attrs.src, end: offset + block.nodeSize });
  });
  const change = calculateChecklistPreambleChange(blocks.map((block) => block.code));
  if (change) tr.insert(change.after === null ? 0 : blocks[change.after].end, tr.doc.type.schema.nodes.rawBlock.create({ src: change.code }));
}

/** How many task items `doc` holds. */
export function countTaskItems(doc: Node): number {
  let count = 0;
  doc.descendants((node) => {
    if (node.type.name === 'taskItem') count++;
    return node.isBlock && !node.isTextblock;
  });
  return count;
}
