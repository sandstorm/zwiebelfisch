// Heading numbers as Typst computes them from `#set heading(numbering: ..)` rules, and the code that switches
// numbering on or off. Pure: works on Typst code, not on a view's document. See model.ts.
import { numberingFormatter } from './numbering';

/**
 * Heading numbers as Typst computes them, from the `#set heading(numbering:
 * ..)` rules of the code blocks before a heading.
 *
 * Approximations (the preview shows the real numbers):
 * - only rules at the start of a line in top-level raw blocks count; rules in
 *   content blocks, show rules, `#heading(numbering: ..)[..]` calls and
 *   headings inside raw boxes are not seen;
 * - a rule applies from its place in the document to the next rule;
 * - numbering functions and patterns with numeral systems `numbering.ts`
 *   does not implement count, but show no number.
 */

/** What a rule sets: numbered or not, and how numbers look (null: numbered, but not shown). */
interface Numbering {
  numbered: boolean;
  format: ((numbers: readonly number[]) => string) | null;
}

const UNNUMBERED: Numbering = { numbered: false, format: null };

/** The rule that switches numbering on: Typst's default pattern. */
export const HEADING_NUMBERING_RULE = '#set heading(numbering: "1.")';

/**
 * Numbers headings in document order as Typst's heading counter does,
 * following the heading set rules of the code met on the way.
 */
export class HeadingCounter {
  private readonly counter: number[] = [];
  private numbering = UNNUMBERED;

  /** Follows the heading set rules in `code` (a top-level code block) from here on; the last one wins. */
  readRules(code: string): void {
    this.numbering = lastNumbering(code) ?? this.numbering;
  }

  /** Counts a heading of `level` (1 = top); its number as shown, or null when it shows none. */
  count(level: number): string | null {
    if (!this.numbering.numbered) return null;
    step(this.counter, level);
    return this.numbering.format?.(this.counter) ?? null;
  }
}

/** Typst's counter step at `level`: missing levels start at zero, deeper ones are dropped. */
function step(counter: number[], level: number): void {
  while (counter.length < level) counter.push(0);
  counter[level - 1]++;
  counter.length = level;
}

/** Whether the heading set rules in `code` leave headings numbered. */
export function numbersHeadings(code: string): boolean {
  return lastNumbering(code)?.numbered === true;
}

/** `src` without the `numbering` argument of its heading set rules; a rule left without arguments goes, with its line. */
export function withoutHeadingNumbering(src: string): string {
  let result = src;
  for (const rule of setHeadingRules(src).reverse()) {
    const rest = rule.args.filter((arg) => numberingValue(arg) === null);
    if (rest.length === rule.args.length) continue;
    result = rest.length > 0 ? `${result.slice(0, rule.from)}#set heading(${rest.join(', ')})${result.slice(rule.to)}` : withoutLine(result, rule);
  }
  return result;
}

/** `text` without the range `from`..`to` and the line break after it (before it, on the last line). */
function withoutLine(text: string, { from, to }: { from: number; to: number }): string {
  if (text[to] === '\n') return text.slice(0, from) + text.slice(to + 1);
  return text.slice(0, text[from - 1] === '\n' ? from - 1 : from) + text.slice(to);
}

/** What the last heading set rule in `src` that sets `numbering` sets, if any. */
function lastNumbering(src: string): Numbering | undefined {
  let found: Numbering | undefined;
  for (const { args } of setHeadingRules(src)) {
    for (const arg of args) {
      const value = numberingValue(arg);
      if (value !== null) found = numberingOf(value);
    }
  }
  return found;
}

function numberingOf(value: string): Numbering {
  if (value === 'none') return UNNUMBERED;
  const pattern = /^"((?:[^"\\]|\\.)*)"$/.exec(value);
  return { numbered: true, format: pattern ? numberingFormatter(pattern[1].replace(/\\(.)/g, '$1')) : null };
}

/** The value of a `numbering: value` argument; null for other arguments. */
function numberingValue(arg: string): string | null {
  const named = /^numbering\s*:\s*([\s\S]*)$/.exec(arg);
  return named ? named[1].trim() : null;
}

/** `#set heading(..)` rules starting a line: their range in `src` and their arguments, trimmed. */
function setHeadingRules(src: string): { from: number; to: number; args: string[] }[] {
  const rules: { from: number; to: number; args: string[] }[] = [];
  for (const match of src.matchAll(/^([ \t]*)#set[ \t]+heading[ \t]*\(/gm)) {
    const open = match.index + match[0].length - 1;
    const close = closingParen(src, open);
    if (close < 0) continue;
    const args = splitArgs(src.slice(open + 1, close));
    rules.push({ from: match.index + match[1].length, to: close + 1, args });
  }
  return rules;
}

const OPENING = '([{';
const CLOSING = ')]}';

/** The index of the parenthesis closing the one at `open` (strings skipped), or -1. */
function closingParen(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const char = src[i];
    if (char === '"') i = stringEnd(src, i);
    else if (OPENING.includes(char)) depth++;
    else if (CLOSING.includes(char) && --depth === 0) return i;
  }
  return -1;
}

/** The index of the quote closing the string literal starting at `start`. */
function stringEnd(src: string, start: number): number {
  let i = start + 1;
  while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1;
  return i;
}

/** Splits an argument list at its top-level commas. */
function splitArgs(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (char === '"') i = stringEnd(inner, i);
    else if (OPENING.includes(char)) depth++;
    else if (CLOSING.includes(char)) depth--;
    else if (char === ',' && depth === 0) {
      args.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  args.push(inner.slice(start));
  return args.map((arg) => arg.trim()).filter((arg) => arg !== '');
}
