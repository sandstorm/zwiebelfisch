import type { SyntaxNode } from '@lezer/common';
import { typstParser } from 'codemirror-lang-typst/lezer';
import { callArguments, calleeName, children, trailingContent } from '../../../core/typst-syntax/typst-syntax';

/**
 * `src` split into a note call's parts; null unless it is exactly one margin note call.
 *
 * The source syntax of `drafting` margin notes, the one place that knows it:
 *
 *   #margin-note(..named)[note]          a point note
 *   #margin-note(..named)[text][note]    a range note, highlighting `text`
 *
 * `head` is everything before the first `[`: `#margin-note` and any
 * parenthesized named arguments. Only these forms count as notes, and only
 * without syntax errors, a non-empty one-paragraph `text` and nothing after
 * the last `]`. Every other `margin-note` call is ordinary code.
 */
export function parseNoteCall(src: string): NoteCall | null {
  const hash = typstParser.parse(src).topNode.firstChild;
  const call = hash?.nextSibling;
  if (hash?.name !== 'Hash' || hash.from !== 0 || call?.to !== src.length || call.nextSibling) return null;
  const syntax = noteCallSyntax(src, call);
  if (!syntax) return null;
  const { head, text, note } = syntax;
  return text ? { head, text: src.slice(text.from + 1, text.to - 1), note } : { head, note };
}

/** The package margin notes come from; its import is added with the first note. */
export const DRAFTING = '@preview/drafting:0.2.2';
/** The function name, as imported from `drafting`. */
export const MARGIN_NOTE = 'margin-note';
/** drafting's function that sets every note's look (and `hidden`) from where it is called on. */
export const SET_DEFAULTS = 'set-margin-note-defaults';
/** The head of a new note's call. */
export const NOTE_HEAD = `#${MARGIN_NOTE}`;

/** A margin note's call as source text; `text` only for a range note. */
export interface NoteCall {
  head: string;
  text?: string;
  note: string;
}

/** A margin note call inside parsed source: its head and note as text, its highlighted text as syntax (range notes). */
export interface NoteCallSyntax {
  head: string;
  /** The `[text]` content block of a range note; null for a point note. */
  text: SyntaxNode | null;
  note: string;
}

/** The source around a range note's highlighted text: `open` text `close`. */
export function rangeNoteSyntax(head: string, note: string): { open: string; close: string } {
  return { open: `${head}[`, close: `][${note}]` };
}

export function printNoteCall({ head, text, note }: NoteCall): string {
  if (text === undefined) return `${head}[${note}]`;
  const { open, close } = rangeNoteSyntax(head, note);
  return open + text + close;
}

/**
 * The parts of `call`, a `FuncCall` right after a `#` in parsed `source`, if
 * it is a margin note; null for any other call.
 */
export function noteCallSyntax(source: string, call: SyntaxNode): NoteCallSyntax | null {
  const blocks = callsMarginNote(source, call) ? trailingContent(call) : null;
  const namedOnly = callArguments(call).every((arg) => arg.name === 'Named');
  if (!blocks || blocks.length < 1 || blocks.length > 2 || !namedOnly || hasError(call)) return null;
  const text = blocks.length === 2 ? blocks[0] : null;
  if (text && !isOneParagraph(text)) return null;
  const note = blocks.at(-1)!;
  return { head: source.slice(call.from - 1, blocks[0].from), text, note: source.slice(note.from + 1, note.to - 1) };
}

/**
 * Whether `source` holds a margin note call in markup from `from` (its `#`)
 * to exactly `to`.
 */
export function isNoteCallAt(source: string, from: number, to: number): boolean {
  const hash = typstParser.parse(source).resolveInner(from, 1);
  const call = hash.nextSibling;
  return hash.name === 'Hash' && hash.from === from && isMarkup(hash.parent)
    && call?.from === from + 1 && call.to === to && noteCallSyntax(source, call) !== null;
}

/**
 * `note` as it can be written into a note's brackets without changing where
 * the call ends: brackets without a partner escaped or, if the markup still
 * breaks the call (a trailing `\`, `//`, an unclosed `` ` `` or `$`, …),
 * all of it escaped as plain text. Null if neither works.
 */
export function safeNote(note: string): string | null {
  for (const candidate of [balanceBrackets(note), escapeText(note)]) {
    const parsed = parseNoteCall(printNoteCall({ head: NOTE_HEAD, note: candidate }));
    if (parsed?.text === undefined && parsed?.note === candidate) return candidate;
  }
  return null;
}

/** Escapes every character that starts markup or code, so `text` reads back as itself. */
export function escapeText(text: string): string {
  return text.replace(/[\\`$#*_<@[\]]|\/(?=[/*])/g, (c) => `\\${c}`);
}

/** A call of `margin-note` right after its `#`. */
function callsMarginNote(source: string, call: SyntaxNode): boolean {
  const hash = call.prevSibling;
  return call.name === 'FuncCall' && hash?.name === 'Hash' && hash.to === call.from && calleeName(call, source) === MARGIN_NOTE;
}

function hasError(node: SyntaxNode): boolean {
  let found = false;
  node.toTree().iterate({
    enter: (child) => {
      if (child.type.isError || child.name === 'Error') found = true;
      return !found;
    },
  });
  return found;
}

/** A content block with markup that is not empty and has no paragraph break. */
function isOneParagraph(block: SyntaxNode): boolean {
  const markup = block.getChild('Markup');
  return markup !== null && markup.firstChild !== null && !children(markup).some((n) => n.name === 'Parbreak');
}

function isMarkup(node: SyntaxNode | null): boolean {
  return node?.name === 'Markup' || node?.name === 'Typst';
}

/** Escapes `[` and `]` without a partner. */
function balanceBrackets(markup: string): string {
  const open: number[] = [];
  const escape = new Set<number>();
  for (let i = 0; i < markup.length; i++) {
    if (markup[i] === '\\') i++;
    else if (markup[i] === '[') open.push(i);
    else if (markup[i] === ']' && open.pop() === undefined) escape.add(i);
  }
  for (const i of open) escape.add(i);
  return [...markup].map((c, i) => (escape.has(i) ? `\\${c}` : c)).join('');
}
