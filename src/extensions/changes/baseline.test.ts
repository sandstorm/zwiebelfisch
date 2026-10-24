// Tests for baseline.ts.
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../core/paths/paths';
import { ScmHost, type SourceControl, type SourceControlHistoryItem } from '../../hosts/scm/scm';
import { Baseline } from './baseline';

const MAIN = ProjectPath.of('/main.typ');
const item: SourceControlHistoryItem = { id: 'c1', parentIds: [], subject: 'First', message: 'First' };

function setup() {
  const scm = new ScmHost();
  let answer: (bytes: Uint8Array | undefined) => void = () => {};
  const provideFileContent = vi.fn(() => new Promise<Uint8Array | undefined>((resolve) => (answer = resolve)));
  const control: SourceControl = {
    id: 'git',
    label: 'Git',
    busy: false,
    onDidChange: new EventEmitter<void>().event,
    commit() {},
    quickDiffProvider: { provideOriginalText: (path) => (path === MAIN ? 'last commit' : undefined) },
    historyProvider: { provideHistoryItems: async () => ({ items: [] }), provideHistoryItemChanges: async () => [], provideFileContent, onDidChangeCurrentHistoryItem: new EventEmitter<void>().event },
  };
  scm.registerSourceControl(control);
  const baseline = new Baseline(scm);
  const changed = vi.fn();
  baseline.onDidChange(changed);
  return { baseline, control, provideFileContent, answer: (bytes: Uint8Array | undefined) => answer(bytes), changed };
}

describe('Baseline', () => {
  it('is the last commit at first: the source controls’ originals', () => {
    const { baseline } = setup();
    expect(baseline.commit).toBeUndefined();
    expect(baseline.original(MAIN)).toBe('last commit');
    expect(baseline.original(ProjectPath.of('/other.typ'))).toBeUndefined();
  });

  it('loads a chosen commit’s text once, tells when it came, and goes back to the last commit', async () => {
    const { baseline, control, provideFileContent, answer, changed } = setup();
    baseline.setCommit(control, item);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(baseline.commit).toBe(item);
    expect(baseline.original(MAIN)).toBeUndefined();
    expect(baseline.original(MAIN)).toBeUndefined();
    expect(provideFileContent).toHaveBeenCalledTimes(1);
    expect(provideFileContent).toHaveBeenCalledWith('c1', MAIN);
    answer(new TextEncoder().encode('at c1'));
    await Promise.resolve();
    await Promise.resolve();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(baseline.original(MAIN)).toBe('at c1');

    baseline.setCommit();
    expect(baseline.original(MAIN)).toBe('last commit');
  });

  it('counts a file not there at the commit as empty; drops an answer for a commit no longer chosen', async () => {
    const { baseline, control, answer } = setup();
    baseline.setCommit(control, item);
    baseline.original(MAIN);
    baseline.setCommit(control, { ...item, id: 'c2' });
    answer(new TextEncoder().encode('at c1'));
    await Promise.resolve();
    await Promise.resolve();
    expect(baseline.original(MAIN)).toBeUndefined();
    answer(undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(baseline.original(MAIN)).toBe('');
  });
});
