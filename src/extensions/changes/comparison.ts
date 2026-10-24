// What the changes are shown of, and the texts they are shown against. See changes in changes.ts.
import { EventEmitter, type Event } from '../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../core/paths/paths';
import type { Memento } from '../../hosts/extension-host/extension-host';
import type { Scm, SourceControl, SourceControlHistoryItem } from '../../hosts/scm/scm';
import { relativeTime, shortId } from './window/history-list';

/**
 * What the editors show the changes of (IntelliJ's "Show changes" of a commit, or a comparison):
 * - `since`: from `item` (default: the last commit) to the current state, in the live editors
 * - `commit`: what `item` changed, from its first parent to it
 * - `range`: from commit `from` to commit `to`
 * The last two go to a commit: its files are shown as they were there, read-only.
 */
export type Comparison =
  | { readonly kind: 'since'; readonly item?: SourceControlHistoryItem }
  | { readonly kind: 'commit'; readonly item: SourceControlHistoryItem }
  | { readonly kind: 'range'; readonly from: SourceControlHistoryItem; readonly to: SourceControlHistoryItem };

/** The commit the changes of `comparison` start at: its id; null: none (a first commit's: all is new); undefined: the last commit. */
export function fromOf(comparison: Comparison): string | null | undefined {
  if (comparison.kind === 'since') return comparison.item?.id;
  if (comparison.kind === 'commit') return comparison.item.parentIds[0] ?? null;
  return comparison.from.id;
}

/** The commit the changes of `comparison` go to; undefined: the current state. */
export function toOf(comparison: Comparison): SourceControlHistoryItem | undefined {
  return comparison.kind === 'since' ? undefined : comparison.kind === 'commit' ? comparison.item : comparison.to;
}

/**
 * What `comparison` is, in words: `long` for the History panel ("Changes in 84c6e2f “Title”", "Changes from ebd0bc4
 * to 84c6e2f", "Changes since 84c6e2f (to now)", "Changes since last commit"), `short` for the status bar (`since`:
 * how long ago, at `now`), `from` for the editor of a commit's file ("changes since ebd0bc4").
 */
export function describe(comparison: Comparison, now: number): { long: string; short: string; from: string } {
  if (comparison.kind === 'commit') {
    const id = shortId(comparison.item);
    const parent = comparison.item.parentIds[0];
    return { long: `Changes in ${id} “${comparison.item.subject}”`, short: `Changes in ${id}`, from: parent ? `changes since ${parent.slice(0, 7)}` : 'all new' };
  }
  if (comparison.kind === 'range') {
    const text = `Changes from ${shortId(comparison.from)} to ${shortId(comparison.to)}`;
    return { long: text, short: text, from: `changes since ${shortId(comparison.from)}` };
  }
  const { item } = comparison;
  if (!item) return { long: 'Changes since last commit', short: 'Changes since last commit', from: 'changes since last commit' };
  const ago = item.timestamp === undefined ? '' : ` (${relativeTime(item.timestamp, now)})`;
  return { long: `Changes since ${shortId(item)} (to now)`, short: `Changes since ${shortId(item)}${ago}`, from: `changes since ${shortId(item)}` };
}

/**
 * The one comparison the editors, the History panel, the toggle and the status bar show (`comparison`; undefined:
 * none), and the files' texts at its commits. The texts of a commit come from the first source control with a
 * `historyProvider` (`provideFileContent`; '' for a file not there), those of the last commit from the first
 * `quickDiffProvider` that has the file. A commit's text loads on first use (`text` is undefined meanwhile, or after
 * it failed) and is kept, as commits do not change; `onDidChange` fires when the comparison changed and when a text
 * came. Whether a comparison is shown is the viewer's choice, kept for later visits (`state`): one shown comes back
 * as the changes since the last commit.
 *
 * Used by: the changes extension, for everything it shows.
 */
export class ShownChanges {
  #comparison: Comparison | undefined;
  readonly #texts = new Map<string, string>();
  readonly #loading = new Map<string, Promise<string>>();
  readonly #changed = new EventEmitter<void>();
  readonly onDidChange: Event<void> = this.#changed.event;

  constructor(
    private readonly scm: Scm,
    private readonly state: Memento,
  ) {
    this.#comparison = state.get<unknown>(SHOWN_KEY) === true ? { kind: 'since' } : undefined;
  }

  get comparison(): Comparison | undefined {
    return this.#comparison;
  }

  /** Shows `comparison` (default: the changes since the last commit). */
  show(comparison: Comparison = { kind: 'since' }): void {
    this.#set(comparison);
  }

  hide(): void {
    this.#set(undefined);
  }

  /** The source control whose commits are compared: the first with a `historyProvider`. */
  get control(): SourceControl | undefined {
    return this.scm.sourceControls.find((control) => control.historyProvider);
  }

  /** Whether a source control has the texts of the last commit (a `quickDiffProvider`). */
  get hasOriginals(): boolean {
    return this.scm.sourceControls.some((control) => control.quickDiffProvider);
  }

  /**
   * The text of `path` at commit `id` (null: none, ''; undefined: the last commit, the source controls' original),
   * as far as loaded; undefined: not known (yet).
   */
  text(id: string | null | undefined, path: ProjectPath): string | undefined {
    if (id === null) return '';
    if (id === undefined) return this.#lastCommitted(path);
    const known = this.#texts.get(key(id, path));
    if (known === undefined) void this.load(id, path).catch(() => {});
    return known;
  }

  /** The text of `path` at commit `id`, once loaded ('' for a file not there); rejects when it cannot be read. */
  load(id: string, path: ProjectPath): Promise<string> {
    const at = key(id, path);
    const known = this.#texts.get(at);
    if (known !== undefined) return Promise.resolve(known);
    let loading = this.#loading.get(at);
    if (!loading) {
      const provider = this.control?.historyProvider;
      if (!provider) return Promise.reject(new Error('No history here'));
      loading = provider.provideFileContent(id, path).then(
        (bytes) => {
          const text = bytes ? new TextDecoder().decode(bytes) : '';
          this.#texts.set(at, text);
          this.#changed.fire();
          return text;
        },
        (error: unknown) => {
          this.#loading.delete(at);
          throw error;
        },
      );
      this.#loading.set(at, loading);
    }
    return loading;
  }

  dispose(): void {
    this.#changed.dispose();
  }

  #lastCommitted(path: ProjectPath): string | undefined {
    for (const control of this.scm.sourceControls) {
      const text = control.quickDiffProvider?.provideOriginalText(path);
      if (text !== undefined) return text;
    }
    return undefined;
  }

  #set(comparison: Comparison | undefined): void {
    if (same(this.#comparison, comparison)) return;
    this.#comparison = comparison;
    void this.state.update(SHOWN_KEY, comparison !== undefined);
    this.#changed.fire();
  }
}

/**
 * What one editor's changes are drawn against: the original text (undefined: draw none), and word when it, or whether
 * it is shown, changed.
 */
export interface ChangesState {
  original(): string | undefined;
  readonly onDidChange: Event<void>;
}

/** Where the viewer's last choice is kept (`globalState`). */
const SHOWN_KEY = 'show';

function key(id: string, path: ProjectPath): string {
  return `${id}\n${path}`;
}

/** Whether `a` and `b` compare the same commits the same way. */
function same(a: Comparison | undefined, b: Comparison | undefined): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && fromOf(a) === fromOf(b) && toOf(a)?.id === toOf(b)?.id;
}
