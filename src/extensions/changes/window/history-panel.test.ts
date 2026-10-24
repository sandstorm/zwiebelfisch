// @vitest-environment jsdom
// Tests for history-panel.ts.
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../../core/paths/paths';
import type { SourceControl, SourceControlHistoryItem } from '../../../hosts/scm/scm';
import { HistoryPanel, type HistoryPanelOptions } from './history-panel';

const item = (id: string, extra: Partial<SourceControlHistoryItem> = {}): SourceControlHistoryItem => ({
  id,
  parentIds: [],
  subject: `Commit ${id}`,
  message: `Commit ${id}`,
  displayId: id,
  author: 'Ada Lovelace',
  coAuthors: ['Bob'],
  timestamp: Date.now(),
  ...extra,
});

const flush = () => new Promise((resolve) => setTimeout(resolve));

function setup() {
  const provideHistoryItems = vi.fn(async ({ cursor }: { cursor?: string }) => (cursor ? { items: [item('c3')] } : { items: [item('c1'), item('c2', { coAuthors: [] })], cursor: 'more' }));
  const provideHistoryItemChanges = vi.fn(async (id: string) => [
    { path: ProjectPath.of(`/letters/${id}/main.typ`), kind: 'added' as const },
    { path: ProjectPath.of('/gone.typ'), kind: 'deleted' as const },
  ]);
  const control: SourceControl = {
    id: 'gitlab',
    label: 'GitLab',
    busy: false,
    onDidChange: new EventEmitter<void>().event,
    commit() {},
    resourceStates: [{ path: ProjectPath.of('/main.typ'), decorations: { badge: 'M' } }, { path: ProjectPath.of('/notes/a.typ'), decorations: { badge: 'A' } }],
    historyProvider: {
      provideHistoryItems,
      provideHistoryItemChanges,
      provideFileContent: async () => undefined,
      onDidChangeCurrentHistoryItem: new EventEmitter<void>().event,
    },
  };
  /** The mode, as the changes extension keeps it: undefined off, else since `item` (undefined: the last commit). */
  let changes: { item: SourceControlHistoryItem | undefined } | undefined;
  const setChanges = (value: typeof changes) => {
    changes = value;
    panel.render();
  };
  const options = {
    sourceControl: () => control,
    visible: () => true,
    changes: () => changes,
    showChangesSince: vi.fn((_control: SourceControl, since: SourceControlHistoryItem | undefined) => setChanges({ item: since })),
    hideChanges: vi.fn(() => setChanges(undefined)),
    openFile: vi.fn(),
    isOpenable: (path: ProjectPath) => path !== '/gone.typ',
  } satisfies HistoryPanelOptions;
  const parent = document.createElement('div');
  const panel = new HistoryPanel(parent, options);
  panel.refresh();
  const rows = () => [...parent.querySelectorAll<HTMLButtonElement>('.zwf-history__row')];
  const subject = (row: HTMLElement) => row.querySelector('.zwf-history__subject')!.textContent;
  const row = (text: string) => rows().find((each) => subject(each) === text)!;
  const compared = () => rows().filter((each) => each.getAttribute('aria-current') === 'true').map(subject);
  const mode = () => parent.querySelector('[data-testid="zwf-history-mode"]')!;
  const files = () => [...parent.querySelectorAll<HTMLButtonElement>('.zwf-history__entry:not(.zwf-history__entry--uncommitted) .zwf-history__file-row')];
  return { parent, panel, options, control, provideHistoryItems, provideHistoryItemChanges, rows, subject, row, compared, mode, files, setChanges };
}

describe('HistoryPanel', () => {
  it('lists what is not committed, then the commits by day with one avatar and "+N", and loads more', async () => {
    const { parent, rows, subject, provideHistoryItems } = setup();
    await flush();
    expect(rows().map(subject)).toEqual(['Not in GitLab yet', 'Commit c1', 'Commit c2']);
    expect(parent.querySelector('.zwf-history__day')!.textContent).toBe('Today');
    expect(rows().map((each) => each.querySelector('.zwf-history__people')!.textContent)).toEqual(['', 'AL+1', 'AL']);
    expect(rows()[1].querySelector<HTMLElement>('.zwf-history__people')!.title).toBe('Ada Lovelace, Bob');
    expect(rows()[1].querySelector('.zwf-history__meta')!.textContent).toBe('Ada Lovelace, Bob · just now · c1');

    parent.querySelector<HTMLButtonElement>('.zwf-history__more')!.click();
    await flush();
    expect(rows()).toHaveLength(4);
    expect(parent.querySelector('.zwf-history__more')).toBeNull();
    expect(provideHistoryItems).toHaveBeenCalledTimes(2);
  });

  it('says on top whether changes are shown and since what, and turns them on and off there', async () => {
    const { mode, options, control, setChanges } = setup();
    await flush();
    expect(mode().textContent).toBe('Show changes since last commit');
    mode().querySelector('button')!.click();
    expect(options.showChangesSince).toHaveBeenLastCalledWith(control, undefined);
    expect(mode().textContent).toBe('Showing changes since last commit✕');
    setChanges({ item: item('84c6e2f', { subject: 'Fix the letter' }) });
    expect(mode().textContent).toBe('Showing changes since 84c6e2f “Fix the letter”✕');
    mode().querySelector<HTMLButtonElement>('button[aria-label="Stop showing changes"]')!.click();
    expect(options.hideChanges).toHaveBeenCalledOnce();
    expect(mode().textContent).toBe('Show changes since last commit');
  });

  it('compares with a commit chosen and lists its files; another switches; the compared one again stops; off folds them', async () => {
    const { rows, row, compared, mode, files, options, setChanges, provideHistoryItemChanges } = setup();
    await flush();
    row('Commit c1').click();
    expect(compared()).toEqual(['Commit c1']);
    expect(row('Commit c1').getAttribute('aria-expanded')).toBe('true');
    expect(row('Commit c1').textContent).toContain('Compared');
    expect(mode().textContent).toContain('since c1 “Commit c1”');
    await flush();
    expect(files().map((file) => file.textContent)).toEqual(['+letters/c1/main.typ', '−gone.typ']);

    row('Commit c2').click();
    expect(compared()).toEqual(['Commit c2']);
    expect(row('Commit c1').getAttribute('aria-expanded')).toBe('false');
    await flush();
    expect(files().map((file) => file.textContent)).toEqual(['+letters/c2/main.typ', '−gone.typ']);

    row('Commit c2').click();
    expect(options.hideChanges).toHaveBeenCalledOnce();
    expect(compared()).toEqual([]);
    expect(files()).toEqual([]);
    expect(rows().every((each) => each.getAttribute('aria-expanded') !== 'true')).toBe(true);

    row('Commit c1').click();
    expect(compared()).toEqual(['Commit c1']);
    expect(files()).toHaveLength(2);
    expect(provideHistoryItemChanges).toHaveBeenCalledTimes(2);
    setChanges(undefined);
    expect(compared()).toEqual([]);
    expect(files()).toEqual([]);
    setChanges({ item: undefined });
    expect(compared()).toEqual([]);
  });

  it("shows a file's kind as a symbol with its name, opens it, one not in the project does not", async () => {
    const { row, files, options } = setup();
    await flush();
    row('Commit c1').click();
    await flush();
    const kind = files()[0].querySelector('.zwf-history__kind')!;
    expect(kind.getAttribute('aria-label')).toBe('Added');
    expect(kind.classList).toContain('zwf-history__kind--added');
    expect(files()[0].querySelector('.zwf-history__name')!.textContent).toBe('main.typ');
    expect(files()[0].title).toBe('letters/c1/main.typ');
    expect(files()[1].disabled).toBe(true);
    files()[0].click();
    expect(options.openFile).toHaveBeenCalledWith('/letters/c1/main.typ');
  });

  it('opens a file not committed yet with the changes since the last commit', async () => {
    const { parent, rows, options, control } = setup();
    await flush();
    rows()[0].click();
    const uncommittedFiles = [...parent.querySelectorAll<HTMLButtonElement>('.zwf-history__entry--uncommitted .zwf-history__file-row')];
    expect(uncommittedFiles.map((file) => file.querySelector('.zwf-history__kind')!.getAttribute('aria-label'))).toEqual(['Modified', 'Added']);
    uncommittedFiles[0].click();
    expect(options.showChangesSince).toHaveBeenLastCalledWith(control, undefined);
    expect(options.openFile).toHaveBeenLastCalledWith('/main.typ');
  });

  it('narrows to a scope: its commits and its uncommitted files; back to the project', async () => {
    const { parent, panel, rows, provideHistoryItems } = setup();
    await flush();
    panel.setScope({ kind: 'folder', path: ProjectPath.of('/notes') });
    await flush();
    expect(provideHistoryItems).toHaveBeenLastCalledWith({ scope: { kind: 'folder', path: '/notes' }, cursor: undefined, limit: 50 });
    expect(parent.querySelector('.zwf-history__scope')!.textContent).toBe('Folder notes');
    expect(rows()[0].querySelector('.zwf-history__meta')!.textContent).toBe('1 file');
    parent.querySelector<HTMLButtonElement>('button[aria-label="Show the history of the whole project"]')!.click();
    expect(panel.scope).toBeUndefined();
  });

  it('offers "Load more" after a page without commits that goes on, and after a failure', async () => {
    const { parent, provideHistoryItems } = setup();
    provideHistoryItems.mockReset();
    provideHistoryItems.mockResolvedValueOnce({ items: [], cursor: 'on' }).mockRejectedValueOnce(new Error('HTTP 502')).mockResolvedValueOnce({ items: [item('c9')] });
    const more = () => parent.querySelector<HTMLButtonElement>('.zwf-history__more');
    parent.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!.click();
    await flush();
    expect(parent.textContent).not.toContain('No commits.');
    more()!.click();
    await flush();
    expect(parent.textContent).toContain('The history could not be read: HTTP 502');
    more()!.click();
    await flush();
    expect(parent.textContent).toContain('Commit c9');
    expect(more()).toBeNull();
  });
});
