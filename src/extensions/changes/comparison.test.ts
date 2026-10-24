// Tests for comparison.ts.
import { describe as group, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../core/paths/paths';
import type { Memento } from '../../hosts/extension-host/extension-host';
import { ScmHost, type SourceControlHistoryItem } from '../../hosts/scm/scm';
import { describe, fromOf, ShownChanges, toOf, type Comparison } from './comparison';

const MAIN = ProjectPath.of('/main.typ');
const item = (id: string, parentIds: string[] = []): SourceControlHistoryItem => ({ id, parentIds, subject: `Commit ${id}`, message: `Commit ${id}`, displayId: id.slice(0, 7), timestamp: 0 });
const A = item('aaaaaaa1', []);
const B = item('bbbbbbb2', [A.id]);

function setup(stored: Record<string, unknown> = {}) {
  const scm = new ScmHost();
  const answers: ((bytes: Uint8Array | undefined) => void)[] = [];
  const provideFileContent = vi.fn(() => new Promise<Uint8Array | undefined>((resolve) => answers.push(resolve)));
  scm.registerSourceControl({
    id: 'git',
    label: 'Git',
    busy: false,
    onDidChange: new EventEmitter<void>().event,
    commit() {},
    quickDiffProvider: { provideOriginalText: (path) => (path === MAIN ? 'last commit' : undefined) },
    historyProvider: {
      currentHistoryItemRef: undefined,
      provideHistoryItems: async () => ({ items: [] }),
      provideHistoryItemChanges: async () => [],
      provideFileContent,
      onDidChangeCurrentHistoryItem: new EventEmitter<void>().event,
    },
  });
  const state: Memento = { get: (key: string) => stored[key] as never, update: async (key, value) => void (stored[key] = value) };
  const shown = new ShownChanges(scm, state);
  const changed = vi.fn();
  shown.onDidChange(changed);
  const answer = async (text: string | undefined) => {
    answers.shift()!(text === undefined ? undefined : new TextEncoder().encode(text));
    await Promise.resolve();
    await Promise.resolve();
  };
  return { shown, changed, provideFileContent, answer, stored };
}

group('Comparison', () => {
  it('starts and ends where each kind says', () => {
    const cases: [Comparison, string | null | undefined, string | undefined][] = [
      [{ kind: 'since' }, undefined, undefined],
      [{ kind: 'since', item: A }, A.id, undefined],
      [{ kind: 'commit', item: B }, A.id, B.id],
      [{ kind: 'commit', item: A }, null, A.id],
      [{ kind: 'range', from: A, to: B }, A.id, B.id],
    ];
    for (const [comparison, from, to] of cases) expect([fromOf(comparison), toOf(comparison)?.id]).toEqual([from, to]);
  });

  it('says what it is', () => {
    expect(describe({ kind: 'commit', item: B }, 0)).toEqual({ long: 'Changes in bbbbbbb “Commit bbbbbbb2”', short: 'Changes in bbbbbbb', from: 'changes since aaaaaaa' });
    expect(describe({ kind: 'range', from: A, to: B }, 0).long).toBe('Changes from aaaaaaa to bbbbbbb');
    expect(describe({ kind: 'since', item: A }, 2 * 24 * 3600_000)).toMatchObject({ long: 'Changes since aaaaaaa (to now)', short: 'Changes since aaaaaaa (2 days ago)' });
    expect(describe({ kind: 'since' }, 0).short).toBe('Changes since last commit');
  });
});

group('ShownChanges', () => {
  it('shows one comparison at a time, tells when it changes (not for the same again), and keeps whether one is shown', () => {
    const { shown, changed, stored } = setup();
    expect(shown.comparison).toBeUndefined();
    shown.show({ kind: 'commit', item: B });
    shown.show({ kind: 'commit', item: { ...B } });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(stored.show).toBe(true);
    shown.hide();
    expect(shown.comparison).toBeUndefined();
    expect(stored.show).toBe(false);
    expect(setup({ show: true }).shown.comparison).toEqual({ kind: 'since' });
  });

  it('gives the last commit’s texts at once, a commit’s once loaded (one request, kept), none for no commit', async () => {
    const { shown, changed, provideFileContent, answer } = setup();
    expect(shown.text(undefined, MAIN)).toBe('last commit');
    expect(shown.text(null, MAIN)).toBe('');
    expect(shown.text(A.id, MAIN)).toBeUndefined();
    expect(shown.text(A.id, MAIN)).toBeUndefined();
    expect(provideFileContent).toHaveBeenCalledTimes(1);
    expect(provideFileContent).toHaveBeenCalledWith(A.id, MAIN);
    await answer('at A');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(shown.text(A.id, MAIN)).toBe('at A');
    await expect(shown.load(A.id, MAIN)).resolves.toBe('at A');
    expect(provideFileContent).toHaveBeenCalledTimes(1);
  });

  it('counts a file not there at a commit as empty', async () => {
    const { shown, answer } = setup();
    const loading = shown.load(B.id, MAIN);
    await answer(undefined);
    await expect(loading).resolves.toBe('');
    expect(shown.text(B.id, MAIN)).toBe('');
  });
});
