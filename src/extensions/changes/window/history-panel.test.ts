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

function setup(baseline: () => SourceControlHistoryItem | undefined = () => undefined) {
  const provideHistoryItems = vi.fn(async ({ cursor }: { cursor?: string }) => (cursor ? { items: [item('c3')] } : { items: [item('c1'), item('c2')], cursor: 'more' }));
  const control: SourceControl = {
    id: 'gitlab',
    label: 'GitLab',
    busy: false,
    onDidChange: new EventEmitter<void>().event,
    commit() {},
    resourceStates: [{ path: ProjectPath.of('/main.typ'), decorations: { badge: 'M' } }, { path: ProjectPath.of('/notes/a.typ'), decorations: { badge: 'A' } }],
    historyProvider: {
      provideHistoryItems,
      provideHistoryItemChanges: async () => [
        { path: ProjectPath.of('/main.typ'), kind: 'modified' },
        { path: ProjectPath.of('/gone.typ'), kind: 'deleted' },
      ],
      provideFileContent: async () => undefined,
      onDidChangeCurrentHistoryItem: new EventEmitter<void>().event,
    },
  };
  const options = {
    sourceControl: () => control,
    visible: () => true,
    baseline,
    showChangesSince: vi.fn(),
    openFile: vi.fn(),
    isOpenable: (path: ProjectPath) => path !== '/gone.typ',
  } satisfies HistoryPanelOptions;
  const parent = document.createElement('div');
  const panel = new HistoryPanel(parent, options);
  panel.refresh();
  const rows = () => [...parent.querySelectorAll<HTMLButtonElement>('.zwf-history__row')];
  return { parent, panel, options, control, provideHistoryItems, rows };
}

describe('HistoryPanel', () => {
  it('lists what is not committed, then the commits by day with initials, and loads more', async () => {
    const { parent, rows, provideHistoryItems } = setup();
    await flush();
    expect(rows().map((row) => row.querySelector('.zwf-history__subject')!.textContent)).toEqual(['Not in GitLab yet', 'Commit c1', 'Commit c2']);
    expect(parent.querySelector('.zwf-history__day')!.textContent).toBe('Today');
    expect([...rows()[1].querySelectorAll('.zwf-history__avatar')].map((avatar) => avatar.textContent)).toEqual(['AL', 'B']);
    expect(rows()[1].querySelector('.zwf-history__meta')!.textContent).toBe('just now · c1');

    parent.querySelector<HTMLButtonElement>('.zwf-history__more')!.click();
    await flush();
    expect(rows()).toHaveLength(4);
    expect(parent.querySelector('.zwf-history__more')).toBeNull();
    expect(provideHistoryItems).toHaveBeenCalledTimes(2);
  });

  it('shows the changes since a commit chosen and lists its files; a file opens, one not in the project does not', async () => {
    const { parent, rows, options, control } = setup();
    await flush();
    rows()[1].click();
    expect(options.showChangesSince).toHaveBeenCalledWith(control, expect.objectContaining({ id: 'c1' }));
    expect(parent.textContent).toContain('Loading…');
    await flush();
    const files = [...parent.querySelectorAll<HTMLButtonElement>('.zwf-history__file-row')];
    expect(files.map((file) => file.textContent)).toEqual(['Mmain.typ', 'Dgone.typ']);
    expect(files[1].disabled).toBe(true);
    files[0].click();
    expect(options.openFile).toHaveBeenCalledWith('/main.typ');

    rows()[0].click();
    parent.querySelector<HTMLButtonElement>('.zwf-history__entry--uncommitted .zwf-history__file-row')!.click();
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

  it('marks the commit the changes are shown since; choosing it again only folds its files', async () => {
    let baseline: SourceControlHistoryItem | undefined;
    const { panel, rows, options } = setup(() => baseline);
    await flush();
    baseline = item('c1');
    panel.render();
    const row = () => rows().find((each) => each.getAttribute('aria-current') === 'true');
    expect(row()?.querySelector('.zwf-history__subject')!.textContent).toBe('Commit c1');
    row()!.click();
    expect(options.showChangesSince).not.toHaveBeenCalled();
    expect(row()!.getAttribute('aria-expanded')).toBe('true');
  });
});
