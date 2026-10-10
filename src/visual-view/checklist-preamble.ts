import type { Node } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';

/**
 * Task lists are Typst bullet items starting with `[ ]` / `[x]`, which only
 * render as checkboxes under the Universe package cheq
 * (https://typst.app/universe/package/cheq): its import and `#show:
 * checklist`. This module makes sure a document has both, exactly once.
 */
const IMPORT = '#import "@preview/cheq:0.4.0": checklist';
const SHOW = '#show: checklist';
export const CHECKLIST_PREAMBLE = `${IMPORT}\n${SHOW}`;

/** Any version, importing `checklist` (or everything). */
const HAS_IMPORT = /#import\s+"@preview\/cheq:[^"]*"\s*:\s*(?:\*|[^\n]*\bchecklist\b)/;
/** `#show: checklist` or `#show: checklist.with(..)`. */
const HAS_SHOW = /#show\s*:\s*checklist\b/;

/**
 * Adds what is missing of cheq's import and show rule to the top-level raw
 * blocks of `tr.doc` (the only place they apply to the whole document): both
 * as one block at the top, the show rule right after an existing import, or
 * the import at the top before an existing show rule.
 */
export function ensureChecklistPreamble(tr: Transaction): void {
  const importAt = blockEnd(tr.doc, HAS_IMPORT);
  const hasShow = blockEnd(tr.doc, HAS_SHOW) !== null;
  const raw = (src: string) => tr.doc.type.schema.nodes.rawBlock.create({ src });
  if (importAt === null) tr.insert(0, raw(hasShow ? IMPORT : CHECKLIST_PREAMBLE));
  else if (!hasShow) tr.insert(importAt, raw(SHOW));
}

/** The position after the first top-level raw block whose source matches `pattern`. */
function blockEnd(doc: Node, pattern: RegExp): number | null {
  let end: number | null = null;
  doc.forEach((block, offset) => {
    if (end === null && block.type.name === 'rawBlock' && pattern.test(block.attrs.src)) end = offset + block.nodeSize;
  });
  return end;
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
