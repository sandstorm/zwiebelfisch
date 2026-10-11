// drafting's note defaults set before the main file. See registerShowComments in ../preview/preview.ts.
import type { FileContent } from '../../../core/project/project';
import type { PdfEntry } from '../../../core/typst-engine/typst-engine';
import { DRAFTING, SET_DEFAULTS } from './margin-note-syntax';

/**
 * Typst lines that call drafting's `set-margin-note-defaults(args)`, imported from the drafting version the project's
 * `.typ` files import. Empty when none imports drafting: a compile never fetches a package the documents do not use.
 */
export function noteDefaultsPrelude(files: Record<string, FileContent>, args: string): string[] {
  const drafting = draftingImport(files);
  return drafting ? [`#import "${drafting}": ${SET_DEFAULTS}`, `#${SET_DEFAULTS}(${args})`] : [];
}

/** A generated file, at a path `files` does not use (like `path`), that runs `prelude` and then includes `main`. */
export function includingMain(files: Record<string, FileContent>, main: string, path: string, prelude: readonly string[]): PdfEntry {
  const entry = freePath(files, path);
  return { main: entry, sources: { [entry]: [...prelude, `#include "${main.replace(/[\\"]/g, (c) => `\\${c}`)}"`, ''].join('\n') } };
}

/** The drafting package spec the first `.typ` file importing it imports, if any. */
function draftingImport(files: Record<string, FileContent>): string | null {
  const name = DRAFTING.slice(0, DRAFTING.lastIndexOf(':') + 1);
  for (const [path, text] of Object.entries(files)) {
    if (typeof text !== 'string' || !path.endsWith('.typ')) continue;
    const at = text.indexOf(`"${name}`);
    if (at >= 0) return text.slice(at + 1, text.indexOf('"', at + 1));
  }
  return null;
}

function freePath(files: Record<string, unknown>, path: string): string {
  let free = path;
  for (let n = 2; free in files; n++) free = path.replace(/\.typ$/, `-${n}.typ`);
  return free;
}
