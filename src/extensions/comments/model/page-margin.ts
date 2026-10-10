// Page margins that leave room for margin notes (drafting 0.2.2 workaround). See ../comments.ts.
import type { SyntaxNode } from '@lezer/common';
import { typstParser } from 'codemirror-lang-typst/lezer';
import type { TextChange } from '../../../core/typst-document/typst-document';
import { children } from '../../../core/typst-syntax/typst-syntax';

/**
 * Page margins that `drafting` 0.2.2 can place notes in.
 *
 * drafting 0.2.2 crashes on a page margin that is a single length
 * ("type relative length has no method `keys`", drafting.typ line 640:
 * `"inside" in page.margin.keys()` without checking for a dictionary). Typst
 * turns uniform dictionaries (`(rest: a)`, `(x: a, y: a)`) back into a length,
 * so they crash too; `auto` and margins that differ by side work.
 *
 * The edits give every top-level `#set page(.., margin: m)` whose `m` is such
 * a uniform literal a right margin for the notes:
 * `margin: (right: R, rest: m)`, R = 4cm, or 1cm more than `m` (whole cm) when
 * `m` is an absolute length of 4cm or more (equal sides would be uniform again).
 * Margins written any other way (variables, spreads, other dictionaries) are
 * left alone.
 */
export function noteMarginChanges(text: string): TextChange[] {
  const changes: TextChange[] = [];
  for (let node = typstParser.parse(text).topNode.firstChild; node; node = node.nextSibling) {
    const margin = node.name === 'SetRule' && name(text, node) === 'page' ? namedArgument(text, node.getChild('Args'), 'margin') : null;
    const uniform = margin ? uniformMargin(text, margin) : null;
    if (margin && uniform !== null) {
      changes.push({ from: margin.from, to: margin.to, insert: `(right: ${rightMargin(text, uniform)}, rest: ${slice(text, uniform)})` });
    }
  }
  return changes;
}

/** Notes need about this much room (drafting's default note width fits). */
const NOTE_MARGIN_CM = 4;

/** Centimetres per absolute unit. */
const CM: Record<string, number> = { cm: 1, mm: 0.1, in: 2.54, pt: 2.54 / 72 };

/** The side keys of a margin dictionary and the sides each one sets. */
const SIDES: Record<string, string[]> = {
  left: ['left'],
  right: ['right'],
  top: ['top'],
  bottom: ['bottom'],
  x: ['left', 'right'],
  y: ['top', 'bottom'],
  rest: ['left', 'right', 'top', 'bottom'],
};

/** The value all four sides get, if `value` is a literal margin Typst reads as one length; else null. */
function uniformMargin(text: string, value: SyntaxNode): SyntaxNode | null {
  if (isLength(value)) return value;
  return value.name === 'Dict' ? uniformDict(text, value) : null;
}

/** The one length a margin dictionary of side keys gives all four sides; null if it is not that. */
function uniformDict(text: string, dict: SyntaxNode): SyntaxNode | null {
  const entries = children(dict).filter((child) => !['LeftParen', 'RightParen', 'Comma', 'Space'].includes(child.name));
  const sides = new Set<string>();
  const values = new Set<string>();
  for (const entry of entries) {
    const covered = entry.name === 'Named' ? SIDES[name(text, entry)] : undefined;
    const length = entry.name === 'Named' ? argumentValue(entry) : null;
    if (!covered || !length || !isLength(length)) return null;
    covered.forEach((side) => sides.add(side));
    values.add(slice(text, length));
  }
  return sides.size === 4 && values.size === 1 ? argumentValue(entries[0]) : null;
}

/** A length literal or a sum of them (`1.5cm`, `10%`, `1cm + 5%`). */
function isLength(node: SyntaxNode): boolean {
  if (node.name === 'Numeric') return true;
  if (node.name !== 'Binary') return false;
  const [left, op, right, ...rest] = children(node).filter((child) => child.name !== 'Space');
  return rest.length === 0 && ['Plus', 'Minus'].includes(op?.name ?? '') && isLength(left) && isLength(right);
}

/** The right margin for notes, wider than `uniform` (which is what the other sides keep). */
function rightMargin(text: string, uniform: SyntaxNode): string {
  const match = /^(\d+(?:\.\d+)?|\.\d+)(cm|mm|in|pt)$/.exec(slice(text, uniform));
  const cm = match ? Number(match[1]) * CM[match[2]] : 0;
  return cm < NOTE_MARGIN_CM ? `${NOTE_MARGIN_CM}cm` : `${Math.ceil(cm - 1e-9) + 1}cm`;
}

/** The value of the named argument `key` in `args`, if it is there. */
function namedArgument(text: string, args: SyntaxNode | null, key: string): SyntaxNode | null {
  const named = args?.getChildren('Named').find((arg) => name(text, arg) === key);
  return named ? argumentValue(named) : null;
}

function argumentValue(named: SyntaxNode): SyntaxNode | null {
  const value = named.lastChild;
  return value && value.name !== 'Colon' && value.name !== 'Space' ? value : null;
}

/** The identifier naming `node` (a set rule's function, a named argument's key). */
function name(text: string, node: SyntaxNode): string {
  const ident = node.getChild('Ident');
  return ident ? slice(text, ident) : '';
}

function slice(text: string, node: SyntaxNode): string {
  return text.slice(node.from, node.to);
}
