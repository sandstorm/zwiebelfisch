// Raw text (`code`, ```lang … ```): reading a parsed `Raw` node, and writing delimiters around edited code so that
// Typst reads the text back unchanged. See markup in ../markup.ts.
import type { SyntaxNode } from '@lezer/common';

/** Reads a `Raw` syntax node into its parts; null when it is not closed by a matching delimiter. */
export function rawCode(node: SyntaxNode, source: string): RawCode | null {
  const parts: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) parts.push(child);
  const open = parts[0];
  const close = parts.at(-1)!;
  if (node.name !== 'Raw' || parts.length < 2 || open.name !== 'RawDelim' || close.name !== 'RawDelim') return null;
  const fence = open.to - open.from;
  if (close.to - close.from !== fence || close.to !== node.to) return null;
  if (fence < 3) return { fence, lang: null, from: open.to, to: close.from, block: false };
  return { fence, ...fencedText(parts, source), block: source.slice(open.to, close.from).includes('\n') };
}

/** A closed raw element: its delimiters and where the text it shows lies in the source. */
export interface RawCode {
  /** Backticks in each delimiter. */
  fence: number;
  /** The language tag (three or more backticks only). */
  lang: string | null;
  /** The source range of the text, between the delimiters, the tag and the whitespace Typst trims. */
  from: number;
  to: number;
  /** Typst shows it as its own block: three or more backticks around a line break. */
  block: boolean;
}

/** What Typst reads as a language tag: the identifier at the start of `value` ('' if there is none). */
export function codeLanguage(value: string): string {
  return /^[\p{ID_Start}_][\p{ID_Continue}-]*/u.exec(value)?.[0] ?? '';
}

/** Delimiters for a code block showing `text`, keeping the original `fence` unless the text needs a longer one. */
export function codeBlockDelimiters(text: string, lang: string | null, fence: number): { open: string; close: string } {
  const ticks = '`'.repeat(Math.max(3, fence, longestBacktickRun(text) + 1));
  return { open: `${ticks}${codeLanguage(lang ?? '')}\n`, close: `\n${ticks}` };
}

/**
 * Delimiters for inline code showing `text` (one line): single backticks
 * where they work, else a fence longer than any backticks inside, with the
 * spaces Typst trims around text that starts or ends with a backtick.
 */
export function inlineCodeDelimiters(text: string, lang: string | null, fence: number): { open: string; close: string } {
  const tag = codeLanguage(lang ?? '');
  if (fence < 3 && !tag && !text.includes('`')) return { open: '`', close: '`' };
  const ticks = '`'.repeat(Math.max(3, fence, longestBacktickRun(text) + 1));
  return { open: `${ticks}${tag} `, close: `${text.endsWith('`') ? ' ' : ''}${ticks}` };
}

/** Between the fences of ```lang …```: the language tag, then the text without the whitespace Typst trims. */
function fencedText(parts: SyntaxNode[], source: string): { lang: string | null; from: number; to: number } {
  let first = 1;
  const lang = parts[first].name === 'RawLang' ? source.slice(parts[first].from, parts[first++].to) : null;
  if (parts[first].name === 'RawTrimmed' && first < parts.length - 1) first++;
  let last = parts.length - 1;
  if (last - 1 >= first && parts[last - 1].name === 'RawTrimmed') last--;
  const from = parts[first - 1].to;
  return { lang, from, to: Math.max(from, parts[last].from) };
}

function longestBacktickRun(text: string): number {
  return Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
}
