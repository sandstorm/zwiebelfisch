// What a document with task lists needs so that Typst draws them as checkboxes: cheq's import and show rule. See
// ../lists.ts.

/**
 * Task lists are Typst bullet items starting with `[ ]` / `[x]`, which only
 * render as checkboxes under the Universe package cheq
 * (https://typst.app/universe/package/cheq): its import and `#show:
 * checklist`. A document needs both, exactly once.
 */
const IMPORT = '#import "@preview/cheq:0.4.0": checklist';
const SHOW = '#show: checklist';
export const CHECKLIST_PREAMBLE = `${IMPORT}\n${SHOW}`;

/** Code to insert as a block of its own: after the code block `after` (an index), or at the very top (null). */
export interface ChecklistPreambleChange {
  after: number | null;
  code: string;
}

/**
 * What is missing of cheq's import and show rule, given a document's
 * top-level code blocks in order (the only place they apply to the whole
 * document): both as one block at the top, the show rule right after an
 * existing import, or the import at the top before an existing show rule;
 * null when nothing is missing.
 */
export function calculateChecklistPreambleChange(codeBlocks: readonly string[]): ChecklistPreambleChange | null {
  const importIndex = codeBlocks.findIndex((code) => HAS_IMPORT.test(code));
  const hasShow = codeBlocks.some((code) => HAS_SHOW.test(code));
  if (importIndex < 0) return { after: null, code: hasShow ? IMPORT : CHECKLIST_PREAMBLE };
  return hasShow ? null : { after: importIndex, code: SHOW };
}

/** Any version, importing `checklist` (or everything). */
const HAS_IMPORT = /#import\s+"@preview\/cheq:[^"]*"\s*:\s*(?:\*|[^\n]*\bchecklist\b)/;
/** `#show: checklist` or `#show: checklist.with(..)`. */
const HAS_SHOW = /#show\s*:\s*checklist\b/;
