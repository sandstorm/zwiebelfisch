// What to compile for a PDF without comments. See registerIncludeComments in ../preview/preview.ts.
import { typstParser } from 'codemirror-lang-typst/lezer';
import type { FileContent } from '../../../core/project/project';
import type { PdfEntry } from '../../../core/typst-engine/typst-engine';
import { noteCallSyntax } from './margin-note-syntax';
import { includingMain, noteDefaultsPrelude } from './note-defaults';

/**
 * The project as compiled for a PDF without comments; the documents
 * themselves are not touched.
 *
 * - Every margin note call (as the Visual editor knows them) is removed from
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
  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== 'string' || !path.endsWith('.typ')) continue;
    const text = stripNotes(content);
    if (text !== content) sources[path] = text;
  }
  const hide = noteDefaultsPrelude(files, 'hidden: true');
  if (hide.length === 0) return { main, sources };
  const entry = includingMain(files, main, '/.without-comments.typ', hide);
  return { main: entry.main, sources: { ...sources, ...entry.sources } };
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
