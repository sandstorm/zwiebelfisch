// @vitest-environment jsdom
// Tests for history-panel.ts.
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../../core/paths/paths';
import type { SourceControl, SourceControlHistoryItem } from '../../../hosts/scm/scm';
import type { Comparison } from '../comparison';
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
  // newest first: c1, then c2 (older)
  const provideHistoryItems = vi.fn(async ({ cursor }: { cursor?: string }) => (cursor ? { items: [item('c3')] } : { items: [item('c1', { parentIds: ['c2'] }), item('c2', { coAuthors: [] })], cursor: 'more' }));
  const provideHistoryItemChanges = vi.fn(async (id: string, _parent?: string) => [
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
      currentHistoryItemRef: { id: 'head', name: 'main' },
      provideHistoryItems,
      provideHistoryItemChanges,
      provideFileContent: async () => undefined,
      onDidChangeCurrentHistoryItem: new EventEmitter<void>().event,
    },
  };
  /** The comparison, as the changes extension keeps it. */
  let comparison: Comparison | undefined;
  const setComparison = (value: Comparison | undefined) => {
    comparison = value;
    panel.render();
  };
  const options = {
    sourceControl: () => control,
    visible: () => true,
    comparison: () => comparison,
    compare: vi.fn((value: Comparison | undefined) => setComparison(value)),
    openFile: vi.fn(),
    isOpenable: (path: ProjectPath) => path !== '/gone.typ',
    showItemMenu: vi.fn(),
  } satisfies HistoryPanelOptions;
  const parent = document.createElement('div');
  const panel = new HistoryPanel(parent, options);
  panel.refresh();
  const rows = () => [...parent.querySelectorAll<HTMLButtonElement>('.zwf-history__row')];
  const subject = (row: HTMLElement) => row.querySelector('.zwf-history__subject')!.textContent;
  const row = (text: string) => rows().find((each) => subject(each) === text)!;
  /** The commits compared, each with its label. */
  const compared = () => rows().filter((each) => each.getAttribute('aria-current') === 'true').map((each) => `${subject(each)}: ${each.querySelector('.zwf-history__compared')!.textContent}`);
  const mode = () => parent.querySelector('[data-testid="zwf-history-mode"]')!;
  const files = () => [...parent.querySelectorAll<HTMLButtonElement>('.zwf-history__entry:not(.zwf-history__entry--uncommitted) .zwf-history__file-row')];
  const click = (target: HTMLElement, init: MouseEventInit = {}) => target.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
  return { parent, panel, options, control, provideHistoryItems, provideHistoryItemChanges, rows, subject, row, compared, mode, files, click, setComparison };
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

  it('names the comparison on top, and turns it on and off there', async () => {
    const { mode, options, setComparison } = setup();
    await flush();
    expect(mode().textContent).toBe('Show changes since last commit');
    mode().querySelector('button')!.click();
    expect(options.compare).toHaveBeenLastCalledWith({ kind: 'since' });
    expect(mode().textContent).toBe('Changes since last commit✕');
    setComparison({ kind: 'commit', item: item('84c6e2f', { subject: 'Fix the letter' }) });
    expect(mode().textContent).toBe('Changes in 84c6e2f “Fix the letter”✕');
    setComparison({ kind: 'range', from: item('ebd0bc4'), to: item('84c6e2f') });
    expect(mode().textContent).toBe('Changes from ebd0bc4 to 84c6e2f✕');
    setComparison({ kind: 'since', item: item('84c6e2f') });
    expect(mode().textContent).toBe('Changes since 84c6e2f (to now)✕');
    mode().querySelector<HTMLButtonElement>('button[aria-label="Stop showing changes"]')!.click();
    expect(options.compare).toHaveBeenLastCalledWith(undefined);
    expect(mode().textContent).toBe('Show changes since last commit');
  });

  it('shows the changes of a commit clicked and lists its files; again: off; Cmd-click another: the range older to newer', async () => {
    const { row, compared, files, click, options, provideHistoryItemChanges } = setup();
    await flush();
    click(row('Commit c1'));
    expect(options.compare).toHaveBeenLastCalledWith({ kind: 'commit', item: expect.objectContaining({ id: 'c1' }) });
    expect(compared()).toEqual(['Commit c1: Changes']);
    expect(row('Commit c1').getAttribute('aria-expanded')).toBe('true');
    await flush();
    expect(provideHistoryItemChanges).toHaveBeenLastCalledWith('c1', undefined);
    expect(files().map((file) => file.textContent)).toEqual(['+letters/c1/main.typ', '−gone.typ']);

    click(row('Commit c1'));
    expect(options.compare).toHaveBeenLastCalledWith(undefined);
    expect(compared()).toEqual([]);
    expect(files()).toEqual([]);

    click(row('Commit c1'));
    click(row('Commit c2'), { metaKey: true });
    expect(options.compare).toHaveBeenLastCalledWith({ kind: 'range', from: expect.objectContaining({ id: 'c2' }), to: expect.objectContaining({ id: 'c1' }) });
    expect(compared()).toEqual(['Commit c1: To', 'Commit c2: From']);
    expect(row('Commit c2').getAttribute('aria-expanded')).toBe('false');
    await flush();
    expect(provideHistoryItemChanges).toHaveBeenLastCalledWith('c1', 'c2');
    expect(files()).toHaveLength(2);

    click(row('Commit c2'));
    expect(compared()).toEqual(['Commit c2: Changes']);
    click(row('Commit c1'), { ctrlKey: true });
    expect(compared()).toEqual(['Commit c1: To', 'Commit c2: From']);
  });

  it('opens the menu of a commit on a right click', async () => {
    const { row, options } = setup();
    await flush();
    row('Commit c2').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 20 }));
    expect(options.showItemMenu).toHaveBeenCalledWith(expect.objectContaining({ id: 'c2' }), { x: 10, y: 20 });
  });

  it('compares with the next commit clicked after "Compare with…", or not once cancelled', async () => {
    const { panel, row, mode, compared, click, options } = setup();
    await flush();
    panel.compareWith(item('c1'));
    expect(mode().textContent).toBe('Choose the commit to compare c1 with✕');
    mode().querySelector<HTMLButtonElement>('button[aria-label="Cancel"]')!.click();
    expect(mode().textContent).toBe('Show changes since last commit');

    panel.compareWith(item('c1'));
    click(row('Commit c2'));
    expect(options.compare).toHaveBeenLastCalledWith({ kind: 'range', from: expect.objectContaining({ id: 'c2' }), to: expect.objectContaining({ id: 'c1' }) });
    expect(compared()).toEqual(['Commit c1: To', 'Commit c2: From']);
  });

  it('lists the files since a commit to the current commit, under it', async () => {
    const { row, compared, files, setComparison, provideHistoryItemChanges } = setup();
    await flush();
    setComparison({ kind: 'since', item: item('c2') });
    expect(compared()).toEqual(['Commit c2: Since']);
    expect(row('Commit c2').getAttribute('aria-expanded')).toBe('true');
    await flush();
    expect(provideHistoryItemChanges).toHaveBeenLastCalledWith('head', 'c2');
    expect(files()).toHaveLength(2);
  });

  it("shows a file's kind as a symbol with its name; opens it as the comparison shows it", async () => {
    const { row, files, click, options, setComparison } = setup();
    await flush();
    click(row('Commit c1'));
    await flush();
    const kind = files()[0].querySelector('.zwf-history__kind')!;
    expect(kind.getAttribute('aria-label')).toBe('Added');
    expect(kind.classList).toContain('zwf-history__kind--added');
    expect(files()[0].querySelector('.zwf-history__name')!.textContent).toBe('main.typ');
    expect(files()[0].title).toBe('letters/c1/main.typ');
    expect(files()[1].disabled).toBe(false);
    files()[1].click();
    expect(options.openFile).toHaveBeenCalledWith({ path: '/gone.typ', kind: 'deleted' });

    setComparison({ kind: 'since', item: item('c1') });
    await flush();
    expect(files()[1].disabled).toBe(true);
  });

  it('opens a file not committed yet with the changes since the last commit', async () => {
    const { parent, rows, options } = setup();
    await flush();
    rows()[0].click();
    const uncommittedFiles = [...parent.querySelectorAll<HTMLButtonElement>('.zwf-history__entry--uncommitted .zwf-history__file-row')];
    expect(uncommittedFiles.map((file) => file.querySelector('.zwf-history__kind')!.getAttribute('aria-label'))).toEqual(['Modified', 'Added']);
    uncommittedFiles[0].click();
    expect(options.compare).toHaveBeenLastCalledWith({ kind: 'since' });
    expect(options.openFile).toHaveBeenLastCalledWith({ path: '/main.typ', kind: 'modified' });
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
