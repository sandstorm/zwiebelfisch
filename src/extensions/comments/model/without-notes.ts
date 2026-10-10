// withoutNotes: what to compile for a PDF without comments (margin notes removed). See comments.ts and
// ARCHITECTURE.md, "Comments = margin notes".
import { typstParser } from 'codemirror-lang-typst/lezer';
import type { FileContent } from '../../../core/project/project';
import { DRAFTING, noteCallSyntax, SET_DEFAULTS } from './margin-note-syntax';

/** An entry to compile instead of the project's main file, and source texts that replace the project's for it. */
export interface PdfEntry {
  main: string;
  /** Replaced and added `.typ` files by path; the rest of the project stays as it is. */
  sources: Record<string, string>;
}

/**
 * The project as compiled for a PDF without comments; the documents
 * themselves are not touched.
 *
 * - Every margin note call (as the Visual view knows them) is removed from
 *   the copies: a point note entirely, a range note down to its text, which
 *   stays without the highlight. (drafting's `hidden: true` alone would drop
 *   that text too.)
 * - When the project imports drafting, a generated entry hides whatever other
 *   notes there are (`margin-note.with(..)` helpers, calls in code) with
 *   `set-margin-note-defaults(hidden: true)` before including `main`. A
 *   `hidden: false` in the document would show those again.
 */
export function withoutNotes(files: Record<string, FileContent>, main: string): PdfEntry {
  const sources: Record<string, string> = {};
  let drafting: string | null = null;
  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== 'string' || !path.endsWith('.typ')) continue;
    drafting ??= draftingImport(content);
    const text = stripNotes(content);
    if (text !== content) sources[path] = text;
  }
  if (!drafting) return { main, sources };
  const entry = freePath(files, '/.without-comments.typ');
  sources[entry] = [
    `#import "${drafting}": ${SET_DEFAULTS}`,
    `#${SET_DEFAULTS}(hidden: true)`,
    `#include "${main.replace(/[\\"]/g, (c) => `\\${c}`)}"`,
    '',
  ].join('\n');
  return { main: entry, sources };
}

/** The drafting package spec `text` imports, if any. */
function draftingImport(text: string): string | null {
  const name = DRAFTING.slice(0, DRAFTING.lastIndexOf(':') + 1);
  const at = text.indexOf(`"${name}`);
  return at < 0 ? null : text.slice(at + 1, text.indexOf('"', at + 1));
}

function freePath(files: Record<string, unknown>, path: string): string {
  let free = path;
  for (let n = 2; free in files; n++) free = path.replace(/\.typ$/, `-${n}.typ`);
  return free;
}

/** `text` with every margin note call removed, keeping the text of range notes. */
function stripNotes(text: string): string {
  const cuts: [number, number][] = [];
  typstParser.parse(text).iterate({
    enter: (node) => {
      const hash = node.node.prevSibling;
      if (node.name !== 'FuncCall' || hash?.name !== 'Hash' || hash.to !== node.from) return;
      const note = noteCallSyntax(text, node.node);
      if (!note) return;
      if (note.text) cuts.push([hash.from, note.text.from + 1], [note.text.to - 1, node.to]);
      else cuts.push(aloneOnItsLine(text, hash.from, node.to));
    },
  });
  let result = '';
  let last = 0;
  for (const [from, to] of cuts.sort((a, b) => a[0] - b[0])) {
    if (from < last) continue; // inside the part of an enclosing note that is cut already
    result += text.slice(last, from);
    last = to;
  }
  return result + text.slice(last);
}

/** `from..to`, grown to its whole line (with the line break) when nothing else is on that line. */
function aloneOnItsLine(text: string, from: number, to: number): [number, number] {
  const start = text.lastIndexOf('\n', from - 1) + 1;
  const end = text.indexOf('\n', to);
  const alone = end >= 0 && !text.slice(start, from).trim() && !text.slice(to, end).trim();
  return alone ? [start, end + 1] : [from, to];
}
