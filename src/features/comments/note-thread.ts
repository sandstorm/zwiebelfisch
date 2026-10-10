/**
 * A margin note's body as a thread of messages, the one place that knows the
 * format (plain drafting, no helper code):
 *
 *   #margin-note[text][- *Anna* (2026-10-10): Is this right?]
 *   #margin-note[text][- *Anna* (2026-10-10): Is this right?
 *   - *Bob* (2026-10-11): Yes.\
 *     Checked with finance.]
 *   #margin-note[text][
 *     - *Anna* (2026-10-10): Is this right?
 *     - *Bob* (2026-10-11): Yes.
 *   ]
 *
 * One list item per message, `*<name>* (<YYYY-MM-DD>): <text>`, oldest first.
 * The text of such a message is plain text, escaped; a line break is `\` at the
 * end of the line, continued one indentation step (2 spaces) deeper than the
 * marker, a blank line a paragraph break. A thread's first item may lack the
 * name and date (a note that was written by hand before its first reply);
 * that message is markup, shown and edited as written.
 *
 * Typst continues an item on lines indented deeper than its marker's column,
 * which is unknown for an item right after the note's `[` (inline). So a
 * first message of several lines is written in the block form (`\n  - …\n`),
 * and the items after an inline first one start their line (column 0).
 *
 * Any other body (plain text, list items without name and date) is one
 * anonymous message: the whole note, markup. It is never rewritten unless a
 * reply is added, which turns it into the thread's first item.
 *
 * The functions take and return the note's markup (between the call's
 * brackets) and change only what they must: a reply is only an insertion
 * after the last item (so concurrent replies merge into two items), an edit
 * replaces one message's text.
 */
import { escapeText, safeNote } from './margin-note-syntax';

/** One message of a note's thread; `author` and `date` are null for an anonymous message (markup). */
export interface NoteMessage {
  author: string | null;
  /** `YYYY-MM-DD`. */
  date: string | null;
  /** Plain text for a message with an author; markup for an anonymous one. */
  text: string;
}

/** A new message: who wrote it, when (`YYYY-MM-DD`) and its plain text. */
export interface NewMessage {
  author: string;
  date: string;
  text: string;
}

/** The messages of `note`, oldest first: [] for an empty note, one anonymous message for a note that is no thread. */
export function readThread(note: string): NoteMessage[] {
  const items = threadItems(note);
  if (items) return items.map((item) => itemMessage(note, item));
  return note.trim() === '' ? [] : [{ author: null, date: null, text: note }];
}

/**
 * `note` with `reply` appended as the last message. An empty note gets its
 * first item; a note that is no thread becomes its first, anonymous item.
 * Returns `note` unchanged for an empty reply.
 */
export function addReply(note: string, reply: NewMessage): string {
  const text = reply.text.trim();
  if (text === '') return note;
  if (note.trim() === '') {
    // one line stays inline; more need a known marker column: the block form
    return text.includes('\n') ? `\n${replyItem(INDENT, reply)}\n` : replyItem('', reply);
  }
  const items = threadItems(note);
  if (!items) {
    const first = note.trim();
    // a multi-line first item needs a known marker column: the block form
    if (!first.includes('\n')) return `- ${first}\n${replyItem('', reply)}`;
    return `\n${INDENT}- ${indentLines(first, `${INDENT}${INDENT}`)}\n${replyItem(INDENT, reply)}\n`;
  }
  // only an insertion (concurrent replies merge): after an inline first item, siblings start the line
  const { end, indent } = items.at(-1)!;
  return `${note.slice(0, end)}\n${replyItem(indent, reply)}${note.slice(end)}`;
}

/** A list item for `reply`, its marker indented by `indent`. */
function replyItem(indent: string, reply: NewMessage): string {
  return `${indent}- ${header(reply)}${plainText(reply.text.trim(), `${indent}${INDENT}`)}`;
}

/**
 * `note` with the text of message `index` replaced by `text` (plain text for a
 * message with an author, markup for an anonymous one, escaped where it would
 * break the call). Null if there is no such message or the text is empty;
 * `note` itself if the text did not change.
 */
export function editMessage(note: string, index: number, text: string): string | null {
  const messages = readThread(note);
  const message = messages[index];
  if (!message || text.trim() === '') return null;
  if (text === message.text) return note;
  const items = threadItems(note);
  if (!items) return safeNote(text.trim());
  // a multi-line first item needs a known marker column: the block form
  const block = text.includes('\n') ? toBlock(note, items) : { note, items };
  const item = block.items[index];
  const indent = `${item.indent}${INDENT}`;
  const written = message.author === null ? markupText(text.trim(), indent) : plainText(text.trim(), indent);
  if (written === null) return null;
  return block.note.slice(0, item.text) + written + block.note.slice(item.end);
}

/** `note` without message `index`: '' when it was the only one; null if there is no such message. */
export function deleteMessage(note: string, index: number): string | null {
  const items = threadItems(note);
  if (!items) return index === 0 && note.trim() !== '' ? '' : null;
  if (index < 0 || index >= items.length) return null;
  if (items.length === 1) return '';
  // with the line break before it (after the previous item), or before the next item
  const [from, to] = index > 0 ? [items[index - 1].end, items[index].end] : [items[0].start, items[1].start];
  return note.slice(0, from) + note.slice(to);
}

/** `date` as `YYYY-MM-DD`, in local time. */
export function localDate(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// ---------------------------------------------------------------- parsing

/** One indentation step: continuation lines go this much deeper than their marker; the block form's markers too. */
const INDENT = '  ';

const MARKER = /^([ \t]*)-(?=[ \t]|$)/;
const HEADER = /^\*((?:[^*\\\n]|\\.)+)\* \((\d{4}-\d{2}-\d{2})\):(?:[ \t]+|$)/;

interface Item {
  /** The `-`. */
  start: number;
  /** Where the message's text starts (after the marker and, if any, name and date). */
  text: number;
  /** After the last non-blank character. */
  end: number;
  /** The marker line's indentation; '' for an item right after the note's `[` (inline). */
  indent: string;
  inline: boolean;
  author: string | null;
  date: string | null;
}

/** The items of `note` if it is a thread: a list whose items after the first all have name and date, one at least. */
function threadItems(note: string): Item[] | null {
  const items = listItems(note);
  if (!items || !items.slice(1).every((item) => item.author !== null)) return null;
  return items.some((item) => item.author !== null) ? items : null;
}

/** The items of `note` if it consists of one flat list (deeper lines continue an item), else null. */
function listItems(note: string): Item[] | null {
  const items: Item[] = [];
  /** The siblings' indentation; unknown while the only item is inline. */
  let siblings: string | null = null;
  for (const line of lines(note)) {
    const kind = lineKind(line, items.length > 0, siblings);
    if (kind === 'continuation') {
      items.at(-1)!.end = line.at + line.text.trimEnd().length;
    } else if (kind === 'item') {
      if (line.at > 0 || items.length > 0) siblings = line.indent;
      items.push(item(note, line));
    } else {
      return null;
    }
  }
  return items.length > 0 ? items : null;
}

interface Line {
  /** Offset in the note. */
  at: number;
  text: string;
  indent: string;
}

/** The lines of `note` that are not blank. */
function lines(note: string): Line[] {
  let at = 0;
  return note.split('\n').flatMap((text) => {
    const line = { at, text, indent: /^[ \t]*/.exec(text)![0] };
    at += text.length + 1;
    return text.trim() === '' ? [] : [line];
  });
}

/**
 * Whether `line` starts an item (a marker at the siblings' indentation),
 * continues the last one (deeper; after an inline item, whose column is
 * unknown, any indented line but a marker) or ends the list (null).
 */
function lineKind(line: Line, inItem: boolean, siblings: string | null): 'item' | 'continuation' | null {
  const marker = MARKER.test(line.text);
  if (!inItem) return marker ? 'item' : null;
  if (siblings === null) {
    if (marker) return 'item';
    return line.indent === '' ? null : 'continuation';
  }
  if (line.indent.length > siblings.length) return 'continuation';
  return marker && line.indent === siblings ? 'item' : null;
}

function item(note: string, line: Line): Item {
  const start = line.at + line.indent.length;
  const end = line.at + line.text.trimEnd().length;
  const content = start + (/^-[ \t]?/.exec(note.slice(start))![0].length);
  const head = HEADER.exec(note.slice(content, end));
  const inline = line.at === 0;
  return {
    start,
    text: content + (head?.[0].length ?? 0),
    end,
    indent: inline ? '' : line.indent,
    inline,
    author: head ? unescape(head[1]) : null,
    date: head?.[2] ?? null,
  };
}

function itemMessage(note: string, item: Item): NoteMessage {
  const lines = note.slice(item.text, item.end).split('\n').map((line, i) => (i === 0 ? line : line.trimStart()));
  if (item.author === null) return { author: null, date: null, text: lines.join('\n') };
  const text = lines.map((line) => unescape(line.replace(/(?<!\\)((?:\\\\)*)\\$/, '$1'))).join('\n');
  return { author: item.author, date: item.date, text };
}

// --------------------------------------------------------------- printing

function header({ author, date }: NewMessage): string {
  return `*${escapeText(author.replace(/\s+/g, ' ').trim())}* (${date}): `;
}

/**
 * Plain `text` as markup on a list item: escaped, line breaks as `\` + newline,
 * continuation lines indented by `indent`, blank lines kept (paragraph breaks).
 */
function plainText(text: string, indent: string): string {
  const lines = text.split('\n').map((line) => line.trim());
  return lines
    .map((line, i) => {
      if (i === 0) return escapeLine(line);
      const breaks = line !== '' && lines[i - 1] !== '' ? '\\' : '';
      return `${breaks}\n${line === '' ? '' : indent + escapeLine(line)}`;
    })
    .join('');
}

/** `line` escaped as plain text, also where it would start a list, heading or term at the start of a line. */
function escapeLine(line: string): string {
  return escapeText(line)
    .replace(/[~]/g, '\\$&')
    .replace(/^([-+=]|\/(?= ))/, '\\$1')
    .replace(/^(\d+)\./, '$1\\.');
}

/** Markup `text` on a list item: kept as written where it cannot break the call, continuation lines indented. */
function markupText(text: string, indent: string): string | null {
  const safe = safeNote(text);
  return safe === null ? null : indentLines(safe, indent);
}

function indentLines(text: string, indent: string): string {
  return text.split('\n').map((line, i) => (i === 0 || line.trim() === '' ? line.trimEnd() : `${indent}${line.trimStart()}`)).join('\n');
}

/**
 * `note` with an inline first item moved onto its own line (`\n` + one
 * indentation step), so that lines deeper than its marker continue it;
 * the note then ends with a line break before its `]`.
 */
function toBlock(note: string, items: Item[]): { note: string; items: Item[] } {
  const first = items[0];
  if (!first.inline) return { note, items };
  const prefix = `\n${INDENT}`;
  const tail = note.slice(items.at(-1)!.end);
  const end = tail.includes('\n') ? tail : '\n';
  const moved = prefix + note.slice(first.start, items.at(-1)!.end) + end;
  const shift = prefix.length - first.start;
  return {
    note: moved,
    items: items.map((it, i) => ({
      ...it,
      start: it.start + shift,
      text: it.text + shift,
      end: it.end + shift,
      ...(i === 0 ? { indent: INDENT, inline: false } : {}),
    })),
  };
}

function unescape(markup: string): string {
  return markup.replace(/\\(.)/gs, '$1');
}
