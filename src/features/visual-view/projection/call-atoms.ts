import type { SyntaxNode } from '@lezer/common';

/**
 * Standalone function calls the Visual view shows as a fixed widget, keeping
 * their source verbatim (like an image block, but not editable as code):
 *
 * - `#pagebreak(..)`, any arguments → `pageBreak`
 * - `#line(length: 100%, ..)` → `horizontalRule`: a line across the full
 *   width. Only named arguments, and none that position or turn it (`start`,
 *   `end`, `angle`); `stroke` and the like are kept. Any other line stays raw.
 *
 * `args` are the children of the call's `Args` node; `text` gives a node's
 * source. Returns the node type to project to, or null.
 */
export function callAtomType(name: string, args: SyntaxNode[], text: (node: SyntaxNode) => string): string | null {
  if (args[0]?.name !== 'LeftParen' || args.at(-1)?.name !== 'RightParen') return null;
  if (name === 'pagebreak') return 'pageBreak';
  if (name === 'line' && isFullWidthLine(args.slice(1, -1), text)) return 'horizontalRule';
  return null;
}

const POSITIONING = new Set(['start', 'end', 'angle']);

function isFullWidthLine(args: SyntaxNode[], text: (node: SyntaxNode) => string): boolean {
  let fullWidth = false;
  for (const arg of args) {
    if (arg.name === 'Space' || arg.name === 'Comma') continue;
    const name = arg.name === 'Named' ? arg.getChild('Ident') : null;
    if (!name || POSITIONING.has(text(name))) return false;
    if (text(name) === 'length') fullWidth = text(arg.lastChild!) === '100%';
  }
  return fullWidth;
}
