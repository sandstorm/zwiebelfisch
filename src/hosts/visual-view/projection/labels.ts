// Which label (`<name>`) belongs to which block, and printing it back after the block. See projection.ts.
import type { SyntaxNode } from '@lezer/common';

/** A block's label: its name, and the source between the block and `<name>` (`' '`, `''`, `'\n'`). */
export interface BlockLabel {
  name: string;
  gap: string;
}

/** `<name>` after its gap. */
export function labelSyntax({ name, gap }: BlockLabel): string {
  return `${gap}<${name}>`;
}

/**
 * A run's trailing label (after optional spaces), split off its content — if
 * there is content before it (and it is not another label). A run of only a
 * label keeps it.
 */
export function splitTrailingLabel(run: SyntaxNode[]): { content: SyntaxNode[]; label: SyntaxNode | null } {
  const label = run.at(-1)!;
  if (label.name !== 'Label') return { content: run, label: null };
  const content = run.slice(0, -1);
  while (content.at(-1)?.name === 'Space') content.pop();
  // a second label (`<a> <b>`) is beyond what a tag shows: keep the run as it is
  return content.length > 0 && content.at(-1)!.name !== 'Label' ? { content, label } : { content: run, label: null };
}

/**
 * Whether `nodes[index]` is a label that labels `block` (a heading): only
 * spaces (no paragraph break) between the two, and nothing but spaces after
 * it up to a paragraph break, the end or the next block. (`= A <a> text` is
 * not: Typst reads that label as part of the line.)
 */
export function labelAfterBlock(nodes: SyntaxNode[], index: number, block: SyntaxNode, isBlock: (node: SyntaxNode) => boolean): boolean {
  if (nodes[index].name !== 'Label') return false;
  let before = index - 1;
  while (before >= 0 && nodes[before].name === 'Space') before--;
  if (nodes[before] !== block) return false;
  let next = index + 1;
  while (nodes[next]?.name === 'Space') next++;
  const following = nodes[next];
  return !following || following.name === 'Parbreak' || isBlock(following);
}
