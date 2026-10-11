// Heading numbers as Typst computes them from `#set heading(numbering: ..)` rules, and the change that switches
// numbering on or off. Pure: works on Typst code, not on a view's document. See ../headings.ts.
import type { SyntaxNode } from '@lezer/common';
import { typstParser } from 'codemirror-lang-typst/lezer';
import { SourceOffset, SourceRange, type TextChange } from '../../../core/typst-document/typst-document';
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

/**
 * The changes that switch heading numbering in the Typst document `text` off or on: numbered (a top-level rule
 * numbers headings) → the numbering goes from every top-level heading set rule (a rule left without arguments goes,
 * a block that held only it with it); otherwise `HEADING_NUMBERING_RULE` as a block after the code the document
 * starts with. Rules nested in content (`#[#set heading(..)]`) are not seen.
 */
export function calculateNumberingToggle(text: string): TextChange[] {
  const rules = topLevelHeadingRules(text);
  if (rules.some(({ rule }) => numbersHeadings(text.slice(rule.from, rule.to)))) return rules.flatMap((found) => withoutNumbering(text, found));
  const end = leadingCodeEnd(text);
  const at = SourceOffset.of(end ?? 0);
  return [{ from: at, to: at, insert: end === null ? `${HEADING_NUMBERING_RULE}\n\n` : `\n\n${HEADING_NUMBERING_RULE}` }];
}

/** A top-level `#set heading(..)` rule (from its `#`) and the syntax nodes around it. */
interface FoundRule {
  rule: { from: number; to: number };
  before: SyntaxNode | null;
  after: SyntaxNode | null;
}

function topLevelHeadingRules(text: string): FoundRule[] {
  const rules: FoundRule[] = [];
  for (let node = typstParser.parse(text).topNode.firstChild; node; node = node.nextSibling) {
    const rule = node.name === 'Hash' ? node.nextSibling : null;
    if (rule?.name !== 'SetRule' || !/^set\s+heading\b/.test(text.slice(rule.from, rule.to))) continue;
    rules.push({ rule: { from: node.from, to: rule.to }, before: node.prevSibling, after: rule.nextSibling });
    node = rule;
  }
  return rules;
}

/** The change taking the numbering out of one rule: the rule without it, or without the rule (and its line or block). */
function withoutNumbering(text: string, found: FoundRule): TextChange[] {
  const { rule } = found;
  const src = text.slice(rule.from, rule.to);
  const rest = withoutHeadingNumbering(src);
  if (rest === src) return [];
  return [rest === '' ? ruleRemoval(text, found) : { ...SourceRange.of(rule), insert: rest }];
}

/** Removes a whole rule: a block of its own, or a line of a block. */
function ruleRemoval(text: string, found: FoundRule): TextChange {
  return { ...SourceRange.of(blockRange(found) ?? lineRange(text, found)), insert: '' };
}

/** A rule that is a block of its own, with the paragraph break after it (before it, when it is the last block); else null. */
function blockRange({ rule, before, after }: FoundRule): { from: number; to: number } | null {
  if (before !== null && before.name !== 'Parbreak') return null;
  // the last block: nothing after it but the text's final whitespace
  if (after === null || (after.name === 'Space' && after.nextSibling === null)) return { from: before?.from ?? rule.from, to: rule.to };
  return after.name === 'Parbreak' ? { from: rule.from, to: after.to } : null;
}

/** A rule on a line of a block, with its line break. */
function lineRange(text: string, { rule, before, after }: FoundRule): { from: number; to: number } {
  if (isLineBreak(text, after)) return { from: rule.from, to: after!.to };
  return { from: isLineBreak(text, before) ? before!.from : rule.from, to: rule.to };
}

/** Whether `node` is whitespace with a line break. */
function isLineBreak(text: string, node: SyntaxNode | null): boolean {
  return node?.name === 'Space' && text.slice(node.from, node.to).includes('\n');
}

/** Where the code the document starts with ends (`#set`, `#import`, … with comments between), or null without any. */
function leadingCodeEnd(text: string): number | null {
  let end: number | null = null;
  for (let node = typstParser.parse(text).topNode.firstChild; node; node = node.nextSibling) {
    if (node.name === 'Hash' && node.nextSibling) {
      node = node.nextSibling;
      end = node.to;
    } else if (!SKIPPED.has(node.name)) break;
  }
  return end;
}

/** What may stand between the leading code: whitespace and comments. */
const SKIPPED = new Set(['Space', 'Parbreak', 'LineComment', 'BlockComment']);

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
