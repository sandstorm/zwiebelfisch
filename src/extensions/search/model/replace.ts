import type { Disposable } from '../../../core/disposable/disposable';
import { ProjectPath } from '../../../core/paths/paths';
import type { FileChange, FileContent, Project } from '../../../core/project/project';
import { SourceRange, type TextChange, type TypstDocument, type TypstDocumentChangeEvent } from '../../../core/typst-document/typst-document';
import type { FileMatches } from './search-results';
import type { TextQuery } from './text-query';

/**
 * One replace of "Find in files" (a match, a file's matches or all of them) and its undo, one step across all files.
 *
 * Each match is checked first to still be a match where it was found (`TextQuery.replacement`); one whose text
 * changed meanwhile is skipped and counted. A Typst file gets its replacements as exact edits in one change (one
 * event, one shared transaction: comment anchors, cursors and the others' edits elsewhere stay), a text file a new
 * content through `applyEdit` (the host may refuse it).
 *
 * Undo puts back what was replaced where the replacement still is: in a Typst file each replacement follows the
 * file's later edits (anyone's), and one that was edited into is left as it is; a text file is restored only while
 * it has the content the replace gave it. Until `undo` or `dispose` it listens to the Typst files it changed.
 */
export class Replacement {
  /** How many matches were replaced, and in how many files. */
  readonly replaced: number;
  readonly files: number;
  /** How many matches were not replaced: their text changed since they were found. */
  readonly skipped: number;
  /** The files whose change was refused, with the reason in words for people. */
  readonly refused: readonly Refusal[];
  readonly #target: ReplaceTarget;
  /** The files changed; none once undone. */
  #done: readonly Done[];

  private constructor(target: ReplaceTarget, done: readonly Done[], skipped: number, refused: readonly Refusal[]) {
    this.#target = target;
    this.#done = done;
    this.replaced = done.reduce((sum, file) => sum + file.edits.length, 0);
    this.files = done.length;
    this.skipped = skipped;
    this.refused = refused;
  }

  /** Replaces the matches `files` lists (as `query` found them) with what `query` makes of `replace`. */
  static async apply(target: ReplaceTarget, query: TextQuery, files: readonly FileMatches[], replace: string): Promise<Replacement> {
    const done: Done[] = [];
    const refused: Refusal[] = [];
    let skipped = 0;
    for (const { path, matches } of files) {
      const content = target.project.content(path);
      const text = content === undefined ? undefined : textOf(content);
      const changes = text === undefined ? [] : replacements(query, text, matches, replace);
      skipped += matches.length - changes.length;
      if (!changes.length) continue;
      const file = await change(target, path, text!, changes);
      if (typeof file === 'string') refused.push({ path, reason: file });
      else done.push(file);
    }
    return new Replacement(target, done, skipped, refused);
  }

  /** Puts back what was replaced, where the replacement is still there. Once only; the replacement is spent then. */
  async undo(): Promise<UndoResult> {
    this.dispose();
    const done = this.#done;
    this.#done = [];
    let restored = 0;
    let skipped = 0;
    const refused: Refusal[] = [];
    for (const file of done) {
      const valid = file.edits.filter((edit): edit is Edit => edit !== null && this.#holds(file, edit));
      skipped += file.edits.length - valid.length;
      if (!valid.length) continue;
      const inverse = valid.map(({ from, to, original }) => ({ ...SourceRange.of({ from, to }), insert: original }));
      const reason = file.document ? (file.document.change(inverse, SEARCH_ORIGIN), null) : await this.#target.applyEdit({ kind: 'update', path: file.path, content: apply(file.written!, inverse) });
      if (reason) refused.push({ path: file.path, reason });
      else restored += valid.length;
    }
    return { restored, skipped, refused };
  }

  /** Stops following the changed files' edits (the replacement can no longer be undone then). */
  dispose(): void {
    for (const file of this.#done) file.subscription?.dispose();
  }

  /** Whether `edit`'s replacement is still where it was put (the same document, or a text file not changed since). */
  #holds(file: Done, edit: Edit): boolean {
    const { project } = this.#target;
    if (file.document) return project.document(file.path) === file.document && file.document.text.slice(edit.from, edit.to) === edit.inserted;
    const content = project.content(file.path);
    return content !== undefined && textOf(content) === file.written;
  }
}

/** Where a replace happens: the project's files, and the way to change a file that is no Typst file. */
export interface ReplaceTarget {
  readonly project: Pick<Project, 'document' | 'content'>;
  /** Changes a file (`workspace.applyEdit`): resolves to the reason it was refused, or null. */
  applyEdit(change: FileChange): Promise<string | null>;
}

/** A file not changed, and why. */
export interface Refusal {
  readonly path: ProjectPath;
  readonly reason: string;
}

/** What an undo did: how many replacements it put back, how many it left (edited since), the files it could not change. */
export interface UndoResult {
  readonly restored: number;
  readonly skipped: number;
  readonly refused: readonly Refusal[];
}

/** The origin of a replace's changes (`TypstDocument.change`). */
const SEARCH_ORIGIN = 'search';

/** A replacement made: where it is in the file's text now, what it replaced and what it put there. */
interface Edit {
  readonly from: number;
  readonly to: number;
  readonly original: string;
  readonly inserted: string;
}

/** A file changed by a replace: its edits (null once edited into), and its document or the content the replace wrote. */
interface Done {
  readonly path: ProjectPath;
  readonly edits: (Edit | null)[];
  readonly document?: TypstDocument;
  readonly subscription?: Disposable;
  readonly written?: string;
}

/** The changes that replace `matches` of `text` (sorted), those that are still matches there. */
function replacements(query: TextQuery, text: string, matches: readonly SourceRange[], replace: string): TextChange[] {
  return [...matches]
    .sort((a, b) => a.from - b.from)
    .flatMap((match) => {
      const insert = query.replacement(text, match, replace);
      return insert === undefined ? [] : [{ ...SourceRange.of(match), insert }];
    });
}

/** Applies `changes` (sorted, of `text`) to file `path`: what was done, or why it was refused. */
async function change(target: ReplaceTarget, path: ProjectPath, text: string, changes: readonly TextChange[]): Promise<Done | string> {
  let shift = 0;
  const edits = changes.map(({ from, to, insert }) => {
    const at = from + shift;
    shift += insert.length - (to - from);
    return { from: at, to: at + insert.length, original: text.slice(from, to), inserted: insert };
  });
  const document = ProjectPath.isTypst(path) ? target.project.document(path) : undefined;
  if (!document) {
    const written = apply(text, changes);
    return (await target.applyEdit({ kind: 'update', path, content: written })) ?? { path, edits, written };
  }
  document.change(changes, SEARCH_ORIGIN);
  const done: Done = { path, edits, document, subscription: document.onDidChange((event) => follow(done.edits, event)) };
  return done;
}

/** Moves `edits` along with a later change of their file; one the change touches is dropped (null). */
function follow(edits: (Edit | null)[], { contentChanges }: TypstDocumentChangeEvent): void {
  edits.forEach((edit, index) => {
    if (!edit) return;
    let shift = 0;
    for (const { from, to, insert } of contentChanges) {
      // an insertion right at the replacement's start goes before it
      if (to <= edit.from) shift += insert.length - (to - from);
      else if (from < edit.to) return void (edits[index] = null);
    }
    edits[index] = { ...edit, from: edit.from + shift, to: edit.to + shift };
  });
}

/** `text` with `changes` (of `text`, not overlapping) applied. */
function apply(text: string, changes: readonly TextChange[]): string {
  let result = text;
  for (const { from, to, insert } of [...changes].sort((a, b) => b.from - a.from)) result = result.slice(0, from) + insert + result.slice(to);
  return result;
}

function textOf(content: FileContent): string {
  return typeof content === 'string' ? content : new TextDecoder().decode(content);
}
