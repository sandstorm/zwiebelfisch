/**
 * Reading and editing the arguments of an image call, `#image("path", ..)`
 * (an image block) or `image("path", ..)` (the body of a figure). Edits
 * replace only the text of the argument they touch, so a resize or a new alt
 * text is a minimal source change and everything else stays as written.
 */
import type { SyntaxNode } from '@lezer/common';
import { typstParser } from 'codemirror-lang-typst/lezer';

/** A named argument of the call: where its value is, and where the argument before it ends. */
interface NamedArg {
  value: { from: number; to: number };
  from: number;
  to: number;
  /** The end of the previous argument (always there: the path comes first). */
  previousEnd: number;
}

/** The parsed argument list of `call`; null if it is not one closed `image(..)` call. */
function parseArgs(call: string): { named: Map<string, NamedArg>; lastEnd: number } | null {
  const offset = call.startsWith('#') ? 0 : 1;
  const source = offset ? `#${call}` : call;
  const top = typstParser.parse(source).topNode;
  const func = top.getChild('FuncCall');
  const ident = func?.getChild('Ident');
  const args = func?.getChild('Args');
  if (!func || !ident || !args || func.to !== source.length || source.slice(ident.from, ident.to) !== 'image') return null;
  if (args.firstChild?.name !== 'LeftParen' || args.lastChild?.name !== 'RightParen') return null;
  const named = new Map<string, NamedArg>();
  let lastEnd = args.firstChild.to;
  for (let arg: SyntaxNode | null = args.firstChild.nextSibling; arg && arg.to < args.to; arg = arg.nextSibling) {
    if (arg.name === 'Space' || arg.name === 'Comma') continue;
    const name = arg.name === 'Named' ? arg.getChild('Ident') : null;
    const value = name ? arg.lastChild : null;
    if (name && value && value.from > name.to) {
      named.set(source.slice(name.from, name.to), {
        value: { from: value.from - offset, to: value.to - offset },
        from: arg.from - offset,
        to: arg.to - offset,
        previousEnd: lastEnd - offset,
      });
    }
    lastEnd = arg.to;
  }
  return { named, lastEnd: lastEnd - offset };
}

/** The source of argument `name` of the image call `call`, or null if it has none. */
export function imageArg(call: string, name: string): string | null {
  const arg = parseArgs(call)?.named.get(name);
  return arg ? call.slice(arg.value.from, arg.value.to) : null;
}

/**
 * `call` with argument `name` set to `value` (Typst code), or removed when
 * `value` is null. Only that argument's text changes: an existing value is
 * replaced, a new argument goes right after the last one, a removed one takes
 * the comma before it along. Calls it cannot read are returned unchanged.
 */
export function withImageArg(call: string, name: string, value: string | null): string {
  const parsed = parseArgs(call);
  if (!parsed) return call;
  const arg = parsed.named.get(name);
  if (arg && value !== null) return call.slice(0, arg.value.from) + value + call.slice(arg.value.to);
  if (arg) return call.slice(0, arg.previousEnd) + call.slice(arg.to);
  if (value === null) return call;
  return `${call.slice(0, parsed.lastEnd)}, ${name}: ${value}${call.slice(parsed.lastEnd)}`;
}

/** `call` with `width: NN%` (relative to the text width), rounded to whole percent. */
export function withImageWidth(call: string, percent: number): string {
  return withImageArg(call, 'width', `${Math.round(percent)}%`);
}

/** The alt text of the image, if it is written as a plain string. */
export function imageAlt(call: string): string | null {
  const literal = imageArg(call, 'alt');
  return literal !== null && /^"(?:[^"\\\n]|\\["\\])*"$/.test(literal) ? literal.slice(1, -1).replace(/\\(["\\])/g, '$1') : null;
}

/** `call` with the alt text `alt`; an empty one removes the argument. */
export function withImageAlt(call: string, alt: string): string {
  const literal = `"${alt.replace(/["\\]/g, '\\$&').replace(/\n/g, '\\n')}"`;
  return withImageArg(call, 'alt', alt ? literal : null);
}

/** Lengths CSS reads the same way as Typst. */
const CSS_LENGTH = /^\d+(?:\.\d+)?(?:%|pt|mm|cm|in|em)$/;

/** The image's `width` as a CSS width ('' when it has none, or one CSS cannot show). */
export function imageWidthCss(call: string): string {
  const width = imageArg(call, 'width');
  return width !== null && CSS_LENGTH.test(width) ? width : '';
}

/** The code form of an image call (the body of a figure): without the leading `#`. */
export function withoutHash(call: string): string {
  return call.startsWith('#') ? call.slice(1) : call;
}

/** The markup form of an image call (an image block): with the leading `#`. */
export function withHash(call: string): string {
  return call.startsWith('#') ? call : `#${call}`;
}
