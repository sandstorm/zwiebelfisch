// See typst-conversion.ts.
import type { Node } from '@tiptap/pm/model';

/**
 * The nodes of a schema's documents made by `parseTypst` and not modified since, each textblock with how its `src`
 * lines up with its content.
 * - `TypstConversions`: one per schema, so per Visual editor
 * - parser: adds what it makes; serializer: prints these as their `src`; `applyTypstChanges`: carries them over
 *
 * ProseMirror nodes are immutable and unchanged ones keep their identity across transactions, so a node that is here
 * still corresponds exactly to its `src`. Nodes are held weakly: a document no longer referenced is released.
 */
export class UnchangedNodes {
  private readonly layouts = new WeakMap<Node, InlineLayout | null>();

  /** Adds `node`, just parsed; a textblock with its `layout`. */
  add(node: Node, layout: InlineLayout | null = null): void {
    this.layouts.set(node, layout);
  }

  has(node: Node): boolean {
    return this.layouts.has(node);
  }

  /** The layout of `node`, a textblock unchanged since parsed; null for any other node. */
  get(node: Node): InlineLayout | null {
    return this.layouts.get(node) ?? null;
  }

  /** Adds `copy`, a node equal to `original`, if `original` is unchanged since parsed. */
  carryOver(original: Node, copy: Node): void {
    if (this.layouts.has(original)) this.layouts.set(copy, this.layouts.get(original)!);
  }
}

/** How the `src` of a textblock unchanged since parsed lines up with its content: visible runs, with hidden syntax before each. */
export interface InlineLayout {
  runs: { hidden: number; length: number; size: number; kind: 'text' | 'atom' }[];
  /** Hidden syntax after the last run, up to the end of the content. */
  tail: number;
  /** Syntax closing the block, after its content. */
  closing: number;
}

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
