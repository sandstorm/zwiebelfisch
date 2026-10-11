// Which nodes are still exactly what `parseTypst` made of their source, and how a textblock's source lines up with
// its content. Shared by projecting, printing and syncing. See projection.ts.
import type { Node } from '@tiptap/pm/model';

/** How a pristine textblock's `src` lines up with its content: visible runs, with hidden syntax before each. */
export interface InlineLayout {
  runs: { hidden: number; length: number; size: number; kind: 'text' | 'atom' }[];
  /** Hidden syntax after the last run, up to the end of the content. */
  tail: number;
  /** Syntax closing the block, after its content. */
  closing: number;
}

/**
 * Nodes created by `parseTypst` and not modified since. ProseMirror nodes are
 * immutable and unchanged nodes keep their identity across transactions, so
 * membership means "the node still corresponds exactly to its `src`".
 * Textblocks also remember how their `src` lines up with their content.
 */
export const pristine = new WeakMap<Node, InlineLayout | null>();

/** The layout of content placed at `from`..`contentTo` in a textblock whose source ends at `to`. */
export function layout(content: readonly { node: Node; from: number; to: number }[], from: number, contentTo: number, to: number): InlineLayout {
  let cursor = from;
  const runs = content.map(({ node, from: start, to: end }) => {
    const run = { hidden: start - cursor, length: end - start, size: node.nodeSize, kind: textKind(node, end - start) };
    cursor = end;
    return run;
  });
  return { runs, tail: contentTo - cursor, closing: to - contentTo };
}

/** Text shows its source character by character unless it is decoded (an escape or shorthand). */
function textKind(node: Node, length: number): 'text' | 'atom' {
  const plain = node.isText && node.text!.length === length && !node.marks.some((m) => m.type.name === 'typstSource');
  return plain ? 'text' : 'atom';
}
