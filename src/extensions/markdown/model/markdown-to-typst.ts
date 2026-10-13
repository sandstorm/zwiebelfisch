// Markdown read as Typst: its blocks here, their inline text in inline.ts.
import { escapeLineStart, inlineToTypst } from './inline';

/**
 * The Typst markup for `markdown` (CommonMark with GitHub's tables, task items and strikethrough), lossily: headings
 * (`#`, underlined), paragraphs (hard breaks too), fenced and indented code as raw blocks with their language, bullet,
 * numbered (from its first number) and task lists, nested; block quotes as `#quote(block: true)[..]`, rules as
 * `#line(length: 100%)`, pipe tables as `#table(..)` with a `table.header(..)`; inline text see `inlineToTypst`.
 * Dropped: reference links, HTML (escaped as text), tables' alignment, math (escaped: Markdown has none). Text of one
 * line keeps the spaces around it (a paste inside a line).
 */
export function markdownToTypst(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const typst = blocksOf(lines)
    .map(({ typst }) => typst)
    .join('\n\n');
  const [, before, , after] = /^( *)([\s\S]*?)( *)$/.exec(markdown)!;
  return lines.length === 1 && before.length < 4 ? `${before}${typst}${after}` : typst;
}

/** A block read: its Typst, whether it is a list, the line after it. */
interface Block {
  readonly typst: string;
  readonly list?: boolean;
  readonly end: number;
}

/** Reads the block starting at line `at` of `lines`, if it is of its kind. */
type BlockReader = (lines: readonly string[], at: number) => Block | null;

/** The blocks of `lines`, each by the first reader that reads it (a paragraph if none other). */
function blocksOf(lines: readonly string[]): Block[] {
  const blocks: Block[] = [];
  for (let at = 0; at < lines.length; ) {
    if (lines[at].trim() === '') {
      at++;
      continue;
    }
    const block = readBlock(lines, at);
    blocks.push(block);
    at = block.end;
  }
  return blocks;
}

function readBlock(lines: readonly string[], at: number): Block {
  for (const reader of READERS) {
    const block = reader(lines, at);
    if (block) return block;
  }
  return paragraph(lines, at);
}

const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*([^`\s]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/** Whether `line` starts a block that ends a paragraph before it. */
function startsBlock(line: string): boolean {
  return [FENCE, HEADING, RULE, QUOTE].some((pattern) => pattern.test(line)) || /^ {0,3}([-*+]|1[.)]) +\S/.test(line);
}

const READERS: readonly BlockReader[] = [fence, indentedCode, heading, rule, blockQuote, table, list];

/** A fenced code block, up to its closing fence (none: the end). */
function fence(lines: readonly string[], at: number): Block | null {
  const open = FENCE.exec(lines[at]);
  if (!open) return null;
  const [, indent, marker, language] = open;
  const closes = (line: string) => line.trim().length >= marker.length && [...line.trim()].every((c) => c === marker[0]);
  let end = at + 1;
  while (end < lines.length && !closes(lines[end])) end++;
  const code = lines.slice(at + 1, end).map((line) => line.replace(new RegExp(`^ {0,${indent.length}}`), ''));
  return { typst: rawBlock(code.join('\n'), language), end: Math.min(end + 1, lines.length) };
}

/** Code indented by four spaces, up to the next line indented less. */
function indentedCode(lines: readonly string[], at: number): Block | null {
  if (!lines[at].startsWith('    ')) return null;
  let end = at;
  while (end < lines.length && (lines[end].startsWith('    ') || lines[end].trim() === '')) end++;
  while (lines[end - 1].trim() === '') end--;
  return { typst: rawBlock(lines.slice(at, end).map((line) => line.slice(4)).join('\n'), ''), end };
}

function heading(lines: readonly string[], at: number): Block | null {
  const match = HEADING.exec(lines[at]);
  return match && { typst: `${'='.repeat(match[1].length)} ${inlineToTypst(match[2] ?? '')}`, end: at + 1 };
}

function rule(lines: readonly string[], at: number): Block | null {
  return RULE.test(lines[at]) ? { typst: '#line(length: 100%)', end: at + 1 } : null;
}

/** Lines starting with `>`, their inside read as blocks again. */
function blockQuote(lines: readonly string[], at: number): Block | null {
  let end = at;
  while (end < lines.length && QUOTE.test(lines[end])) end++;
  if (end === at) return null;
  const inside = blocksOf(lines.slice(at, end).map((line) => line.replace(QUOTE, '')))
    .map(({ typst }) => typst)
    .join('\n\n');
  return { typst: inside.includes('\n') ? `#quote(block: true)[\n${inside}\n]` : `#quote(block: true)[${inside}]`, end };
}

/** A header row, its delimiter row (as many cells), the rows after it that have a `|`. */
function table(lines: readonly string[], at: number): Block | null {
  const delimiter = lines[at + 1] ?? '';
  if (!lines[at].includes('|') || !TABLE_DELIMITER.test(delimiter)) return null;
  const header = cellsOf(lines[at]);
  if (header.length !== cellsOf(delimiter).length) return null;
  let end = at + 2;
  while (end < lines.length && lines[end].includes('|') && lines[end].trim() !== '') end++;
  const row = (cells: readonly string[]) => header.map((_, i) => `[${inlineToTypst(cells[i] ?? '')}]`).join(', ');
  const rows = lines.slice(at + 2, end).map((line) => `  ${row(cellsOf(line))},`);
  return { typst: [`#table(`, `  columns: ${header.length},`, `  table.header(${row(header)}),`, ...rows, ')'].join('\n'), end };
}

/** The cells of a table row: between its `|` (not `\|`), the outer ones optional. */
function cellsOf(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

/** Items of one kind (bullets or numbers), each up to the next; blank lines between them keep the list going. */
function list(lines: readonly string[], at: number): Block | null {
  const first = ITEM.exec(lines[at]);
  if (!first) return null;
  const numbered = /\d/.test(first[2]);
  const items: string[] = [];
  let end = at;
  for (let item: RegExpExecArray | null = first; item && /\d/.test(item[2]) === numbered; item = ITEM.exec(lines[end] ?? '')) {
    const content = itemContent(lines, end, item);
    items.push(itemTypst(content.lines, numbered ? Number.parseInt(item[2], 10) : null, items.length === 0));
    end = content.end;
    let next = end;
    while (lines[next]?.trim() === '') next++;
    if (ITEM.test(lines[next] ?? '')) end = next;
  }
  return { typst: items.join('\n'), list: true, end };
}

/** The lines of the list item `item` at line `at`, its marker gone, those after the first dedented to its content. */
function itemContent(lines: readonly string[], at: number, item: RegExpExecArray): { lines: string[]; end: number } {
  const [, indent, marker, space, text] = item;
  const column = indent.length + marker.length + (space.length > 0 && space.length <= 4 ? space.length : 1);
  const content = [text];
  let end = at + 1;
  for (let line = itemLine(lines, end, column); line !== null; line = itemLine(lines, ++end, column)) content.push(line);
  return { lines: content, end };
}

/**
 * Line `at` as part of a list item whose content starts at `column`, dedented; null: not part of it. Part of it: a line
 * indented as far as its content, a blank line before such a line, a line continuing its paragraph.
 */
function itemLine(lines: readonly string[], at: number, column: number): string | null {
  const line = lines[at];
  if (line === undefined) return null;
  if (line.trim() === '') return continuesAfterBlank(lines, at, column) ? '' : null;
  if (line.slice(0, column).trim() === '') return line.slice(column);
  const lazy = lines[at - 1].trim() !== '' && !startsBlock(line) && !ITEM.test(line);
  return lazy ? line.trim() : null;
}

/** Whether the blank line `at` lies inside a list item whose content starts at `column`: an indented line follows. */
function continuesAfterBlank(lines: readonly string[], at: number, column: number): boolean {
  let next = at;
  while (lines[next]?.trim() === '') next++;
  return next < lines.length && lines[next].slice(0, column).trim() === '';
}

/**
 * A Typst list item of `content` (its lines, read as blocks): `- ` (a task item `- [ ] `), or, numbered, `+ ` (the
 * first, if it is not 1, `3. `); its lines after the first indented, a nested list right below its text.
 */
function itemTypst(content: readonly string[], number: number | null, first: boolean): string {
  const task = number === null ? /^\[([ xX])\][ \t]+/.exec(content[0]) : null;
  const lines = task ? [content[0].slice(task[0].length), ...content.slice(1)] : content;
  const marker = number === null ? (task ? `- [${task[1] === ' ' ? ' ' : 'x'}]` : '-') : first && number !== 1 ? `${number}.` : '+';
  const blocks = blocksOf(lines);
  const body = blocks.map(({ typst, list }, i) => (i === 0 ? '' : list ? '\n' : '\n\n') + typst).join('');
  return `${marker} ${body.replace(/\n(?=.)/g, '\n  ')}`.trimEnd();
}

/** Lines up to a blank line or the start of another block; underlined with `===` or `---`, a heading. */
function paragraph(lines: readonly string[], at: number): Block {
  let end = at + 1;
  while (end < lines.length && lines[end].trim() !== '' && !SETEXT.test(lines[end]) && !startsBlock(lines[end])) end++;
  const underline = SETEXT.exec(lines[end] ?? '');
  const text = lines.slice(at, end).map((line, i, all) => {
    const trimmed = line.trim();
    return i < all.length - 1 && / {2,}$|\\$/.test(line) ? `${trimmed.replace(/\\$/, '')}${HARD_BREAK}` : trimmed;
  });
  if (underline) return { typst: `${underline[1][0] === '=' ? '=' : '=='} ${inlineToTypst(text.join(' '))}`, end: end + 1 };
  const typst = inlineToTypst(text.join('\n')).split('\n').map(escapeLineStart).join('\n');
  return { typst: typst.replaceAll(HARD_BREAK, ' \\'), end };
}

/** Stands for a hard line break while the inline text is read (a character Markdown text does not have). */
const HARD_BREAK = '';

/** A Typst raw block of `code` in `language` (none: ''), its fence longer than any backticks inside. */
function rawBlock(code: string, language: string): string {
  const tag = /^[\p{ID_Start}_][\p{ID_Continue}-]*/u.exec(language.toLowerCase())?.[0] ?? '';
  const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${tag}\n${code}\n${fence}`;
}
