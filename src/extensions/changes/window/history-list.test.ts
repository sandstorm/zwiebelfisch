// Tests for history-list.ts.
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../../core/paths/paths';
import type { SourceControlHistoryItem, SourceControlHistoryProvider } from '../../../hosts/scm/scm';
import { byDay, HistoryList, initials, inScope, PAGE_SIZE, people, relativeTime, uncommitted } from './history-list';

const at = (iso: string) => new Date(iso).getTime();
const commit = (id: string, timestamp?: number): SourceControlHistoryItem => ({ id, parentIds: [], subject: id, message: id, timestamp });

function provider(pages: Record<string, { items: SourceControlHistoryItem[]; cursor?: string } | Error>): SourceControlHistoryProvider & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    provideHistoryItems: async (options) => {
      calls.push(options);
      const page = pages[options.cursor ?? ''];
      if (page instanceof Error) throw page;
      return page;
    },
    provideHistoryItemChanges: async () => [],
    provideFileContent: async () => undefined,
    onDidChangeCurrentHistoryItem: new EventEmitter<void>().event,
  };
}

describe('HistoryList', () => {
  it('loads page after page of its scope until there is no cursor', async () => {
    const scope = { kind: 'folder' as const, path: ProjectPath.of('/chapters') };
    const source = provider({ '': { items: [commit('a'), commit('b')], cursor: 'next' }, next: { items: [commit('c')] } });
    const list = new HistoryList(source, scope);
    const changed = vi.fn();
    list.onDidChange(changed);
    expect(list.hasMore).toBe(true);
    const loading = list.loadMore();
    expect(list.loading).toBe(true);
    void list.loadMore(); // one request at a time
    await loading;
    expect(list.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(list.hasMore).toBe(true);
    await list.loadMore();
    expect(list.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(list.hasMore).toBe(false);
    await list.loadMore();
    expect(source.calls).toEqual([
      { scope, cursor: undefined, limit: PAGE_SIZE },
      { scope, cursor: 'next', limit: PAGE_SIZE },
    ]);
    expect(changed).toHaveBeenCalledTimes(4);
  });

  it('says why a page could not be read, keeping what it has', async () => {
    const list = new HistoryList(provider({ '': new Error('HTTP 502') }), undefined);
    await list.loadMore();
    expect(list.error).toBe('HTTP 502');
    expect(list.items).toEqual([]);
    expect(list.loading).toBe(false);
  });
});

describe('the list’s parts', () => {
  it('groups commits by day: today, yesterday, then the date', () => {
    const now = at('2026-10-23T15:00:00');
    const groups = byDay([commit('a', at('2026-10-23T10:00:00')), commit('b', at('2026-10-23T09:00:00')), commit('c', at('2026-10-22T18:00:00')), commit('d', at('2026-10-12T18:00:00'))], now);
    expect(groups.map((group) => [group.label, group.items.map((item) => item.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      [new Date(at('2026-10-12T18:00:00')).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), ['d']],
    ]);
  });

  it('tells ages, initials and people', () => {
    const now = at('2026-10-23T15:00:00');
    expect(relativeTime(now - 20_000, now)).toBe('just now');
    expect(relativeTime(now - 14 * 60_000, now)).toBe('14 min ago');
    expect(relativeTime(now - 3 * 3600_000, now)).toBe('3 h ago');
    expect(relativeTime(now - 30 * 3600_000, now)).toBe('yesterday');
    expect(relativeTime(now - 5 * 86400_000, now)).toBe('5 days ago');
    expect(initials('Ada  Byron Lovelace')).toBe('AL');
    expect(initials('ann')).toBe('A');
    expect(people({ ...commit('a'), author: 'Ann', coAuthors: ['Bob'] })).toEqual(['Ann', 'Bob']);
  });

  it('keeps the uncommitted files of the scope', () => {
    const states = ['/main.typ', '/chapters/a.typ', '/chapters-old/b.typ'].map((path) => ({ path: ProjectPath.of(path) }));
    const folder = { kind: 'folder' as const, path: ProjectPath.of('/chapters') };
    expect(uncommitted(states, folder).map((state) => state.path)).toEqual(['/chapters/a.typ']);
    expect(uncommitted(states, undefined)).toHaveLength(3);
    expect(inScope(ProjectPath.of('/main.typ'), { kind: 'file', path: ProjectPath.of('/main.typ') })).toBe(true);
  });
});
