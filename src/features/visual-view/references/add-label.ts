// Adding a label: which block the selection would label, and a name to start from. See references.ts.
import type { Node } from '@tiptap/pm/model';
import { type EditorState, NodeSelection, type Transaction } from '@tiptap/pm/state';
import { labelName, setLabel } from './label-edits';

/**
 * The block a new label goes on: a figure the selection is in (its image or
 * caption), else the selected block or the innermost block around the
 * selection that can carry a label (paragraph, heading, table, code block,
 * raw block, …). Null when there is none.
 */
export function labelTarget(state: EditorState): { pos: number; node: Node } | null {
  const { selection } = state;
  const candidates: { pos: number; node: Node }[] = [];
  if (selection instanceof NodeSelection) candidates.push({ pos: selection.from, node: selection.node });
  const { $from } = selection;
  for (let depth = $from.depth; depth > 0; depth--) candidates.push({ pos: $from.before(depth), node: $from.node(depth) });
  return candidates.find((c) => c.node.type.name === 'figure') ?? candidates.find((c) => canHaveLabel(c.node)) ?? null;
}

/** Whether `node`'s type has the `label` attribute (see nodes.ts, `LABELLED_BLOCKS`). */
function canHaveLabel(node: Node): boolean {
  return 'label' in node.attrs;
}

/** The transaction labelling the `labelTarget` with `input` made a valid name; null without a target or a name. */
export function addLabel(state: EditorState, input: string): Transaction | null {
  const target = labelTarget(state);
  const name = labelName(input);
  return target && name ? setLabel(state, target.pos, name) : null;
}

/** How a new label for `node` starts, by Typst custom: `fig:` / `tab:` for figures, `sec:` for headings, else nothing. */
export function labelPrefix(node: Node): string {
  if (node.type.name === 'heading') return 'sec:';
  if (node.type.name !== 'figure') return '';
  return node.firstChild?.type.name === 'table' ? 'tab:' : 'fig:';
}
