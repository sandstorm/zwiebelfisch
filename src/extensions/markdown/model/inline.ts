// Markdown's inline syntax (emphasis, code, links, images) as Typst markup. See markdownToTypst.
import { quote } from '../../../core/typst-syntax/typst-syntax';

/**
 * The Typst markup for the inline Markdown `text` (a paragraph's, a heading's, a table cell's; line breaks kept):
 * `**strong**` and `__strong__` → `*strong*`, `*emphasis*` and `_emphasis_` → `_emphasis_` (both inside a word as
 * `#strong[..]`, `#emph[..]`), `~~gone~~` → `#strike[..]`, code spans → raw, `[text](url)` → `#link("url")[text]`,
 * `<url>` → `#link("url")`, `![alt](src)` → `#image("src", alt: "alt")`, `<br>` → a line break; bare URLs as they are
 * (Typst links them itself); all other text escaped, `\*` as the character. Lossy: no reference links, no HTML.
 */
export function inlineToTypst(text: string): string {
  let typst = '';
  let plain = '';
  for (let at = 0; at < text.length; ) {
    const span = spanAt(text, at);
    if (span) {
      typst += escapeText(plain) + span.typst;
      plain = '';
      at = span.end;
      // after a call, `(..)` or `.name` would continue it
      if (span.typst.startsWith('#') && /^(?:\(|\.[\p{L}_])/u.test(text.slice(at))) typst += `\\${text[at++]}`;
    } else {
      plain += text[at++];
    }
  }
  return typst + escapeText(plain);
}

/** `line` escaped where Typst would read a heading, list or enum marker at its start (`= `, `- `, `+ `, `/ `, `1. `). */
export function escapeLineStart(line: string): string {
  return line.replace(/^([ \t]*)(=+|[-+/])(?=\s|$)/, '$1\\$2').replace(/^([ \t]*\d+)\.(?=\s|$)/, '$1\\.');
}

/** Markup in Typst a span of Markdown became, and where in the Markdown it ends. */
interface Span {
  readonly typst: string;
  readonly end: number;
}

/** A kind of span: a sticky pattern, and the Typst for its match (null: not this kind after all). */
interface SpanRule {
  readonly pattern: RegExp;
  typst(match: RegExpExecArray, text: string, at: number): string | null;
}

/** The span starting at `at` in `text`, of the first rule that matches there; null: plain text. */
function spanAt(text: string, at: number): Span | null {
  for (const rule of SPAN_RULES) {
    rule.pattern.lastIndex = at;
    const match = rule.pattern.exec(text);
    const typst = match && rule.typst(match, text, at);
    if (typst !== null && typst !== undefined) return { typst, end: at + match![0].length };
  }
  return null;
}

/** Letters and digits: around them Typst's `*` and `_` do not delimit. */
const WORD = /[\p{L}\p{N}]/u;

const SPAN_RULES: readonly SpanRule[] = [
  // a backslash escape: the character itself
  { pattern: /\\([!-/:-@[-`{-~])/y, typst: ([, char]) => escapeText(char) },
  {
    pattern: /(`+)(?!`)([\s\S]*?[^`])\1(?!`)/y,
    typst: ([, , code]) => raw(code.replace(/\n/g, ' ').replace(/^ (.*[^ ].*) $/, '$1')),
  },
  {
    pattern: /!\[((?:\\.|[^\\\]])*)\]\(\s*<?([^\s<>()]+)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/y,
    typst: ([, alt, src]) => `#image(${quote(src)}${alt ? `, alt: ${quote(alt)}` : ''})`,
  },
  {
    pattern: /\[((?:\\.|`[^`]*`|\[[^\]]*\]|[^\\\][])*)\]\(\s*<?([^\s<>]*?)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/y,
    typst: ([, label, url]) => (label === url || label === '' ? `#link(${quote(url)})` : `#link(${quote(url)})[${inlineToTypst(label)}]`),
  },
  { pattern: /<((?:https?|ftp|mailto):[^\s<>]+)>/y, typst: ([, url]) => `#link(${quote(url)})` },
  { pattern: /https?:\/\/[\w!#$%&*+,./:;=?@~-]*[\w#$%&*+/=@~-]/y, typst: ([url], text, at) => (WORD.test(text[at - 1] ?? '') ? null : url) },
  { pattern: /<br\s*\/?>/iy, typst: () => ' \\ ' },
  { pattern: /~~(?=\S)([\s\S]*?\S)~~/y, typst: ([, inner]) => `#strike[${inlineToTypst(inner)}]` },
  { pattern: /(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/y, typst: (match, text, at) => delimited(match, text, at, (inner) => wrap('strong', wrap('emph', inner))) },
  { pattern: /(\*\*|__)(?=\S)([\s\S]*?\S)\1/y, typst: (match, text, at) => delimited(match, text, at, (inner) => wrap('strong', inner)) },
  { pattern: /(\*)(?=\S)((?:\*\*\S[\s\S]*?\*\*|[^*])*?\S)\*/y, typst: (match, text, at) => delimited(match, text, at, (inner) => wrap('emph', inner)) },
  { pattern: /(_)(?=\S)([\s\S]*?\S)_/y, typst: (match, text, at) => delimited(match, text, at, (inner) => wrap('emph', inner)) },
];

/**
 * Emphasis or strong text `match` (its delimiter, its Markdown inside) at `at` in `text`, made by `make` from its inside
 * in Typst; with `_`, only where it does not touch a word (`snake_case` is plain text). Typst's `*` and `_` delimit only
 * outside words: next to one, the function form.
 */
function delimited([whole, delimiter, inner]: RegExpExecArray, text: string, at: number, make: (inner: string) => Wrapped): string | null {
  const before = text[at - 1] ?? '';
  const after = text[at + whole.length] ?? '';
  const touching = WORD.test(before) || WORD.test(after);
  if (delimiter.startsWith('_') && touching) return null;
  return make(inlineToTypst(inner)).typst(touching);
}

/** Typst emphasis or strong text, written with delimiters or, next to a word (`touching`), as a function. */
interface Wrapped {
  typst(touching: boolean): string;
}

function wrap(kind: 'strong' | 'emph', inner: string | Wrapped): Wrapped {
  return {
    typst: (touching) => {
      const content = typeof inner === 'string' ? inner : inner.typst(false);
      if (touching) return `#${kind}[${content}]`;
      const delimiter = kind === 'strong' ? '*' : '_';
      return `${delimiter}${content}${delimiter}`;
    },
  };
}

/** Inline raw text of `code`: in backticks, or `#raw("..")` if it has backticks itself. */
function raw(code: string): string {
  return code.includes('`') ? `#raw(${quote(code)})` : `\`${code}\``;
}

/** Characters that would start Typst markup anywhere in `text` escaped: `*`, `#`, shorthands (`--`, `...`), comments (`//`), … */
function escapeText(text: string): string {
  return text.replace(/[\\*_#$@<[\]`~]|-(?=[-?\d])|\.(?=\.\.)|\/(?=[/*])/g, (c) => `\\${c}`);
}
