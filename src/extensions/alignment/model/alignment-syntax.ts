
// Typst's alignment syntax, as far as the Visual editor edits it. See alignment in ../alignment.ts.

/**
 * The parts of an `#align(..)` argument; null unless it is a literal alignment: `left`, `center`, `right`, `start` or
 * `end`, optionally with one vertical alignment (`top + center`). `start` and `end` read as left and right.
 */
export function alignArgs(args: string): { horizontal: Horizontal | null; vertical: boolean } | null {
  const parts = args.split('+').map((part) => part.trim());
  const horizontal = parts.filter((part) => part in HORIZONTAL);
  const vertical = parts.filter((part) => VERTICAL.has(part));
  if (horizontal.length > 1 || vertical.length > 1 || horizontal.length + vertical.length !== parts.length) return null;
  return { horizontal: horizontal.length > 0 ? HORIZONTAL[horizontal[0]] : null, vertical: vertical.length > 0 };
}

export type Horizontal = 'left' | 'center' | 'right';
/** What the Visual editor's alignment buttons show and set. */
export type TextAlignment = Horizontal | 'justify';

/** `args` (a literal alignment) with its horizontal part set to `horizontal`, keeping the rest as written. */
export function withHorizontal(args: string, horizontal: Horizontal): string {
  const parts = args.split('+');
  const index = parts.findIndex((part) => part.trim() in HORIZONTAL);
  if (index < 0) return `${args.trim()} + ${horizontal}`;
  parts[index] = parts[index].replace(/\w+/, horizontal);
  return parts.join('+');
}

/** What the set rules in a piece of code change, the last rule winning: horizontal alignment, justification. */
export function setRules(code: string): { horizontal?: Horizontal; justify?: boolean } {
  const rules: { horizontal?: Horizontal; justify?: boolean } = {};
  for (const [, func, args] of code.matchAll(/^[ \t]*#set\s+(align|par)\(([^()]*)\)/gm)) {
    if (func === 'align') {
      const horizontal = alignArgs(args)?.horizontal;
      if (horizontal) rules.horizontal = horizontal;
    } else {
      const justify = /\bjustify\s*:\s*(true|false)\b/.exec(args);
      if (justify) rules.justify = justify[1] === 'true';
    }
  }
  return rules;
}

const HORIZONTAL: Record<string, Horizontal> = { left: 'left', center: 'center', right: 'right', start: 'left', end: 'right' };
const VERTICAL = new Set(['top', 'horizon', 'bottom']);
