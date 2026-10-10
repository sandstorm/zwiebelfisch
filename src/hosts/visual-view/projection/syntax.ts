// Reading Typst syntax (Lezer nodes) the way projectors need it: children, calls, closed content, string literals.
// See projection.ts.
import type { SyntaxNode } from '@lezer/common';

/** The children of `node`, in order. */
export function children(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}

/** Whether an argument list is `(..)` alone: closed, and no trailing content block. */
export function parenthesized(args: readonly SyntaxNode[]): boolean {
  return args[0]?.name === 'LeftParen' && args.at(-1)?.name === 'RightParen';
}

/** Whether `node` is a content block `[..]` with its closing bracket. */
export function isClosedContent(node: SyntaxNode): boolean {
  return node.name === 'ContentBlock' && node.lastChild?.name === 'RightBracket' && node.getChild('Markup') !== null;
}

/** A Typst string literal's value, if it uses no escapes other than `\"` and `\\`. */
export function decodeString(literal: string): string | null {
  return /^"(?:[^"\\\n]|\\["\\])*"$/.test(literal) ? literal.slice(1, -1).replace(/\\(["\\])/g, '$1') : null;
}

/** A Typst string literal with value `text`. */
export function quote(text: string): string {
  return `"${text.replace(/["\\]/g, '\\$&')}"`;
}
