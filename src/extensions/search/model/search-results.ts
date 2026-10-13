import { CancellationTokenSource } from '../../../core/cancellation/cancellation';
import type { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../../core/paths/paths';
import type { FileChange, FileContent, Project } from '../../../core/project/project';
import { type MatchPreview, previewMatches } from './match-preview';
import type { TextMatch, TextQuery } from './text-query';

/**
 * The matches of one query in the files of one scope, as "Find in files" lists them, kept current while they live.
 *
 * Searching starts when the results are made and goes through the files in slices of a few milliseconds, so typing
 * stays smooth; `dispose` stops it (a new query or scope makes new results). Every change of a file searches that file
 * again at once, so the matches always fit the text, and the view hears about it on `onDidChange`. Searched are the
 * Typst files and the text files (by `isTextFile`), never images or fonts. At most `MAX_RESULTS` matches are kept
 * (`limitHit`): more are no use to anyone, and the view stays fast.
 */
export class SearchResults {
  readonly #changed = new EventEmitter<void>();
  /** Fires when matches were found, or changed with a file. */
  readonly onDidChange: Event<void> = this.#changed.event;
  /** Resolves once every file in scope has been searched, or the results were disposed. */
  readonly searched: Promise<void>;
  readonly #options: SearchResultsOptions;
  readonly #files = new Map<ProjectPath, readonly TextMatch[]>();
  #count = 0;
  #limitHit = false;
  readonly #cancellation = new CancellationTokenSource();
  readonly #subscription: Disposable;

  constructor(options: SearchResultsOptions) {
    this.#options = options;
    this.#subscription = options.project.onDidChangeFile((change) => this.#update(change));
    this.searched = this.#search();
  }

  /** The files with matches, in the project's order, each with its matches in order. */
  files(): FileMatches[] {
    return this.#options.project
      .paths()
      .filter((path) => this.#files.get(path)?.length)
      .map((path) => ({ path, matches: this.#files.get(path)! }));
  }

  /** How each of `file`'s matches reads in the results, in order: its line cut around it (`previewMatches`). */
  preview({ path, matches }: FileMatches): MatchPreview[] {
    const content = this.#options.project.content(path);
    return content === undefined ? [] : previewMatches(textOf(content), matches);
  }

  /**
   * What each of `file`'s matches becomes with `replace` (`TextQuery.replacement`), in order; undefined for one that is
   * no longer there.
   */
  replacements({ path, matches }: FileMatches, replace: string): (string | undefined)[] {
    const content = this.#options.project.content(path);
    const text = content === undefined ? undefined : textOf(content);
    return matches.map((match) => (text === undefined ? undefined : this.#options.query.replacement(text, match, replace)));
  }

  /** How many matches there are in all. */
  get count(): number {
    return this.#count;
  }

  /** Whether there are more matches than are kept (VS Code's `limitHit`). */
  get limitHit(): boolean {
    return this.#limitHit;
  }

  dispose(): void {
    this.#cancellation.dispose();
    this.#subscription.dispose();
    this.#changed.dispose();
  }

  async #search(): Promise<void> {
    const token = this.#cancellation.token;
    let slice = Date.now();
    let found = false;
    for (const path of this.#options.project.paths()) {
      if (Date.now() - slice > SLICE) {
        if (found) this.#changed.fire();
        found = false;
        await new Promise((resolve) => setTimeout(resolve, 0));
        slice = Date.now();
      }
      if (token.isCancellationRequested || this.#limitHit) break;
      found = this.#searchFile(path) || found;
    }
    if (found && !token.isCancellationRequested) this.#changed.fire();
  }

  #update(change: FileChange): void {
    let changed = change.kind === 'rename' && this.#remove(change.from);
    changed = (change.kind === 'delete' ? this.#remove(change.path) : this.#searchFile(change.path)) || changed;
    if (changed) this.#changed.fire();
  }

  /** Searches `path` (again), within what `MAX_RESULTS` leaves; whether its matches were or are now any. */
  #searchFile(path: ProjectPath): boolean {
    const had = this.#remove(path);
    const content = this.#options.project.content(path);
    if (content === undefined || !this.#includes(path)) return had;
    const room = MAX_RESULTS - this.#count;
    const matches = this.#options.query.findMatches(textOf(content), room + 1);
    if (matches.length > room) {
      this.#limitHit = true;
      matches.pop();
    }
    this.#files.set(path, matches);
    this.#count += matches.length;
    return had || matches.length > 0;
  }

  /** Forgets the matches of `path`; whether it had any. */
  #remove(path: ProjectPath): boolean {
    const matches = this.#files.get(path);
    this.#files.delete(path);
    this.#count -= matches?.length ?? 0;
    return !!matches?.length;
  }

  #includes(path: ProjectPath): boolean {
    const { scope, isTextFile } = this.#options;
    if (!ProjectPath.isTypst(path) && !isTextFile(path)) return false;
    if (scope.kind === 'file') return path === scope.path;
    if (scope.kind === 'folder') return path.startsWith(scope.path.endsWith('/') ? scope.path : `${scope.path}/`);
    return true;
  }
}

export interface SearchResultsOptions {
  readonly project: Pick<Project, 'paths' | 'content' | 'onDidChangeFile'>;
  readonly query: TextQuery;
  readonly scope: SearchScope;
  /** Whether `path` is a text file (searched besides the Typst files). */
  isTextFile(path: ProjectPath): boolean;
}

/** Where to search: every file, the one file `path`, or the files in folder `path` and its subfolders. */
export type SearchScope = { readonly kind: 'project' } | { readonly kind: 'file'; readonly path: ProjectPath } | { readonly kind: 'folder'; readonly path: ProjectPath };

/** The matches in one file. */
export interface FileMatches {
  readonly path: ProjectPath;
  readonly matches: readonly TextMatch[];
}

/** Work this long (ms) before letting the browser handle input again. */
const SLICE = 10;

/** Matches kept at most ("Too many results — narrow the search"). */
const MAX_RESULTS = 5000;

function textOf(content: FileContent): string {
  return typeof content === 'string' ? content : new TextDecoder().decode(content);
}
