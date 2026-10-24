// The commits the History panel lists. See changes in ../changes.ts.
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../../core/paths/paths';
import type { SourceControlHistoryItem, SourceControlHistoryOptions, SourceControlHistoryProvider, SourceControlResourceState } from '../../../hosts/scm/scm';

/** What the History panel lists the commits of: everything, a folder, or a file. */
export type HistoryScope = SourceControlHistoryOptions['scope'];

/**
 * The commits of a scope, as far as loaded: `loadMore` asks the provider for the next page (PAGE_SIZE; the first
 * one on the first call), one request at a time; `onDidChange` fires when it starts and when it ends. A failed
 * request leaves the items as they were and says why in `error`.
 *
 * Used by: the History panel (one list per scope and current commit).
 */
export class HistoryList {
  #items: readonly SourceControlHistoryItem[] = [];
  #cursor: string | undefined;
  #started = false;
  #loading = false;
  #error: string | undefined;
  readonly #changed = new EventEmitter<void>();
  readonly onDidChange = this.#changed.event;

  constructor(
    private readonly provider: SourceControlHistoryProvider,
    readonly scope: HistoryScope,
  ) {}

  get items(): readonly SourceControlHistoryItem[] {
    return this.#items;
  }

  /** Whether more commits can be loaded (before the first page: true). */
  get hasMore(): boolean {
    return !this.#started || this.#cursor !== undefined;
  }

  get loading(): boolean {
    return this.#loading;
  }

  get error(): string | undefined {
    return this.#error;
  }

  async loadMore(): Promise<void> {
    if (this.#loading || !this.hasMore) return;
    this.#loading = true;
    this.#error = undefined;
    this.#changed.fire();
    try {
      const page = await this.provider.provideHistoryItems({ scope: this.scope, cursor: this.#cursor, limit: PAGE_SIZE });
      this.#items = [...this.#items, ...page.items];
      this.#cursor = page.cursor;
      this.#started = true;
    } catch (error) {
      this.#error = error instanceof Error ? error.message : String(error);
    } finally {
      this.#loading = false;
      this.#changed.fire();
    }
  }

  dispose(): void {
    this.#changed.dispose();
  }
}

/** How many commits a page holds. */
export const PAGE_SIZE = 50;

/** Whether `path` is in `scope` (no scope: everything). */
export function inScope(path: ProjectPath, scope: HistoryScope): boolean {
  if (!scope) return true;
  return scope.kind === 'file' ? path === scope.path : path.startsWith(`${scope.path}/`);
}

/** The files with changes not committed that are in `scope`: the pseudo-entry "Not in GitLab yet". */
export function uncommitted(states: readonly SourceControlResourceState[], scope: HistoryScope): readonly SourceControlResourceState[] {
  return states.filter((state) => inScope(state.path, scope));
}

/** `items` grouped by the day they were made, in their order: "Today", "Yesterday", else the date ("Mon, 12 Oct 2026"), at `now`. */
export function byDay(items: readonly SourceControlHistoryItem[], now: number): { label: string; items: SourceControlHistoryItem[] }[] {
  const groups: { label: string; items: SourceControlHistoryItem[] }[] = [];
  for (const item of items) {
    const label = item.timestamp === undefined ? 'Undated' : dayLabel(item.timestamp, now);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

function dayLabel(timestamp: number, now: number): string {
  const day = (time: number) => new Date(time).toDateString();
  if (day(timestamp) === day(now)) return 'Today';
  if (day(timestamp) === day(now - DAY)) return 'Yesterday';
  return new Date(timestamp).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

const DAY = 24 * 60 * 60 * 1000;

/** How long ago `timestamp` was at `now`: "just now", "14 min ago", "3 h ago", "2 days ago". */
export function relativeTime(timestamp: number, now: number): string {
  const minutes = Math.floor((now - timestamp) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** Up to two initials of a name: "Ada Lovelace" "AL", "ann" "A". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words.at(-1)!] : words;
  return letters.map((word) => [...word][0].toUpperCase()).join('');
}

/** The short id of `item`: its `displayId`, else the first 7 characters of its id. */
export function shortId(item: SourceControlHistoryItem): string {
  return item.displayId ?? item.id.slice(0, 7);
}

/** Who made `item`: its author, then its co-authors. */
export function people(item: SourceControlHistoryItem): readonly string[] {
  return [...(item.author ? [item.author] : []), ...(item.coAuthors ?? [])];
}
