// Typst label and reference syntax for the projection: which label belongs to which block, and printing both.
// See projection.ts.
import type { SyntaxNode } from '@lezer/common';
import type { Node } from '@tiptap/pm/model';

/** A block's label: its name, and the source between the block and `<name>` (`' '`, `''`, `'\n'`). */
export interface BlockLabel {
  name: string;
  gap: string;
}

/** `<name>` after its gap. */
export function labelSyntax({ name, gap }: BlockLabel): string {
  return `${gap}<${name}>`;
}

/** `@target` and the supplement as written (`[..]`), if any. */
export function referenceSyntax(target: string, supplement: string | null): string {
  return `@${target}${supplement ?? ''}`;
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
 * Whether `nodes[index]` is a label that labels `heading`: only spaces (no
 * paragraph break) between the two, and nothing but spaces after it up to a
 * paragraph break, the end or the next block. (`= A <a> text` is not: Typst
 * reads that label as part of the line.)
 */
export function labelAfterHeading(nodes: SyntaxNode[], index: number, heading: SyntaxNode, blockKinds: Record<string, unknown>): boolean {
  if (nodes[index].name !== 'Label') return false;
  let before = index - 1;
  while (before >= 0 && nodes[before].name === 'Space') before--;
  if (nodes[before] !== heading) return false;
  let next = index + 1;
  while (nodes[next]?.name === 'Space') next++;
  const following = nodes[next];
  return !following || following.name === 'Parbreak' || following.name in blockKinds;
}

/** The characters of a label's name (a regular expression character class). */
export const LABEL_CHAR = '[\\p{L}\\p{N}_\\-:.]';

/** Characters Typst reads as part of a reference's name; `.` and `:` only when more name characters follow. */
const CONTINUES_REFERENCE = /^(?:[\p{L}\p{N}_-]|[.:][\p{L}\p{N}_-])/u;

/**
 * `input` as a label name Typst accepts and a reference can point to: spaces
 * become `-`, other characters a label cannot hold are dropped, and so are a
 * trailing `.` / `:` (which `@name.` would leave out). Null if nothing is left.
 */
export function labelName(input: string): string | null {
  const name = input.trim().replace(/\s+/g, '-').replace(new RegExp(`(?!${LABEL_CHAR}).`, 'gu'), '').replace(/[.:]+$/, '');
  return name || null;
}

/**
 * Text printed right after a reference without supplement must not extend
 * its name (`@intro` + `s` would read `@intros`): a backslash escapes the
 * first character.
 */
export function guardAfterReference(previous: Node, text: string): string {
  const extends_ = previous.type.name === 'reference' && previous.attrs.supplement === null && CONTINUES_REFERENCE.test(text);
  return extends_ ? `\\${text}` : text;
}
