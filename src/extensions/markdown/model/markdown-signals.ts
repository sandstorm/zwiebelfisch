// How surely a text is Markdown rather than Typst.

/**
 * How surely `text` is Markdown: `sure` where more of its lines have syntax only Markdown has (`## heading`,
 * `**strong**`, `[text](url)`, `- [ ] task`, `> quote`, a table's `|---|`, a `***` rule, a `* ` bullet) than syntax
 * only Typst has (`#set`, `#figure(`, `= heading`, `<label>`, `@reference`, `+ item`); `maybe` where it has as much
 * of each, or only syntax both share (`*x*`, `_x_`, `- item`, `1. item`, code); `no` where it has only Typst's, or
 * no markup at all (prose, `$5`).
 */
export function markdownLikelihood(text: string): 'sure' | 'maybe' | 'no' {
  let markdown = 0;
  let typst = 0;
  for (const line of text.split('\n')) {
    if (MARKDOWN_ONLY.some((pattern) => pattern.test(line))) markdown++;
    if (TYPST_ONLY.some((pattern) => pattern.test(line))) typst++;
  }
  if (markdown > typst) return 'sure';
  if (markdown > 0) return 'maybe';
  return typst === 0 && MARKDOWN_SHARED.test(text) ? 'maybe' : 'no';
}

const MARKDOWN_ONLY = [
  /^ {0,3}#{1,6}[ \t]+\S/,
  /\*\*\S(?:.*?\S)?\*\*|(?:^|\W)__\S(?:.*?\S)?__(?!\w)/,
  /!?\[[^\]]+\]\([^)\s]+(?:\s+"[^"]*")?\)/,
  /^\s*[-*+][ \t]+\[[ xX]\][ \t]/,
  /^ {0,3}>/,
  /^ {0,3}\|?[ \t]*:?-{3,}:?[ \t]*\|/,
  /^ {0,3}([*_])(?:[ \t]*\1){2,}[ \t]*$/,
  /^\s*\*[ \t]+\S/,
];

/** Markdown syntax Typst has too: emphasis, code, list items, a `#` (a heading?). */
const MARKDOWN_SHARED = /[*_`#]|^\s*(?:[-+]|\d+[.)])\s/m;

const TYPST_ONLY = [
  /^\s*#(?:set|let|show|import|include)\b/,
  /^\s*#[\p{L}_][\p{L}\p{N}_-]*[([]/u,
  /^\s*=+[ \t]+\S/,
  /<[\p{L}\p{N}_:.-]+>\s*$/u,
  /(?:^|\s)@[\p{L}_][\p{L}\p{N}_:.-]*/u,
  /^\s*\+[ \t]+\S/,
];
