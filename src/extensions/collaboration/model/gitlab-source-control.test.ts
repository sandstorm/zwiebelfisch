// Tests for gitlab-source-control.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../../core/paths/paths';
import { META_MAP } from '../room-protocol';
import { GitLabSourceControl } from './gitlab-source-control';

afterEach(() => void vi.useRealTimers());

function setup(saves = true) {
  const ydoc = new Y.Doc();
  const meta = ydoc.getMap(META_MAP);
  const sent: string[] = [];
  const messages = new EventEmitter<string>();
  const channel = { send: (payload: string) => void sent.push(payload), onDidReceiveMessage: messages.event };
  const receive = (payload: string) => messages.fire(payload);
  const told: { message: string; severity: string }[] = [];
  const sourceControl = new GitLabSourceControl(ydoc, channel, (message, severity) => told.push({ message, severity }), { saves });
  let changes = 0;
  sourceControl.onDidChange(() => changes++);
  return { meta, sent, receive, sourceControl, told, changes: () => changes };
}

describe('GitLabSourceControl', () => {
  it("for a guest: no commit, and the entries say that members save; guest edits held back are named", () => {
    const { meta, sourceControl } = setup(false);
    expect(sourceControl.commit).toBeUndefined();
    meta.set('baseSha', '0123456789abcdef');
    expect(sourceControl.statusBarItems).toEqual([{ title: 'Saved · 01234567', tooltip: 'Everything is in GitLab (commit 01234567).' }]);
    meta.set('changes', { files: [{ path: '/a.typ', kind: 'modified' }], since: Date.now(), editors: ['Jane (guest)'] });
    meta.set('autoCommit', 10);
    meta.set('commitFailure', { message: 'Guest edits: a member must save.', at: Date.now() });
    const [failure, changes] = sourceControl.statusBarItems;
    expect(failure).toMatchObject({ title: 'Guest edits: a member must save', backgroundColor: 'warning' });
    expect(failure.tooltip).toContain('a member saves them');
    expect(changes.tooltip).toMatch(/A member saves them\.$/);
  });

  it('knows a GitLab-backed room by its last commit', () => {
    const ydoc = new Y.Doc();
    expect(GitLabSourceControl.isGitLabRoom(ydoc)).toBe(false);
    ydoc.getMap(META_MAP).set('baseSha', 'abc');
    expect(GitLabSourceControl.isGitLabRoom(ydoc)).toBe(true);
  });

  it('commits, busy until the server answers; tells the answer and the news', () => {
    const { sent, receive, sourceControl, told, changes } = setup();
    expect(sourceControl).toMatchObject({ id: 'gitlab', label: 'GitLab', defaultCommitMessage: 'Edit via Zwiebelfisch' });
    sourceControl.commit!('Fix typo');
    expect(JSON.parse(sent[0])).toEqual({ type: 'gitlab:save', message: 'Fix typo' });
    expect(sourceControl.busy).toBe(true);
    receive('{"type":"gitlab:merged","sha":"s"}');
    expect(sourceControl.busy).toBe(true);
    receive('{"type":"other"}');
    receive('not json');
    receive('{"type":"gitlab:saved","sha":"0123456789abcdef","author":"Ann"}');
    receive('{"type":"gitlab:saved","sha":"fedcba9876543210","author":"Bob","automatic":true}');
    expect(sourceControl.busy).toBe(false);
    expect(told).toEqual([
      { message: 'Merged new changes from GitLab', severity: 'info' },
      { message: 'Saved version 01234567 (Ann)', severity: 'info' },
      { message: 'Saved version fedcba98 automatically (Bob)', severity: 'info' },
    ]);
    expect(changes()).toBe(3);
  });
});

describe('GitLabSourceControl: what is not in GitLab', () => {
  const T0 = Date.parse('2026-10-11T10:00:00Z');

  it('shows the room\'s changes as M / A / D resource states and as its save status, its age kept up to date', () => {
    vi.useFakeTimers({ now: T0 + 30_000, toFake: ['setInterval', 'clearInterval', 'Date'] });
    const { meta, sourceControl, changes } = setup();
    meta.set('baseSha', '0123456789abcdef');
    expect(sourceControl.resourceStates).toEqual([]);
    expect(sourceControl.statusBarItems).toEqual([{ title: 'Saved · 01234567', tooltip: expect.stringContaining('Everything is in GitLab') }]);

    const files = [
      { path: '/chapters/intro.typ', kind: 'modified' },
      { path: '/new.typ', kind: 'added' },
      { path: '/old.typ', kind: 'deleted' },
      { path: '/x.typ', kind: 'renamed' },
    ];
    meta.set('changes', { files, since: T0, editors: ['Ann', 'Bob'] });
    expect(sourceControl.resourceStates.map((state) => [state.path, state.decorations.badge])).toEqual([
      ['/chapters/intro.typ', 'M'],
      ['/new.typ', 'A'],
      ['/old.typ', 'D'],
    ]);
    meta.set('autoCommit', 10);
    expect(sourceControl.statusBarItems).toEqual([
      {
        title: 'Not in GitLab: 3 files · < 1 min (Ann, Bob)',
        tooltip:
          'Not in GitLab yet:\nM chapters/intro.typ\nA new.typ\nD old.typ\nSaved by itself after 10 min without edits, and when the last person leaves.\nClick to save.',
      },
    ]);
    meta.set('autoCommit', null);
    expect(sourceControl.statusBarItems[0].tooltip).toContain('Not saved by itself: save before you leave.');
    const before = changes();
    vi.advanceTimersByTime(14 * 60_000);
    expect(changes()).toBe(before + 14);
    expect(sourceControl.statusBarItems[0].title).toBe('Not in GitLab: 3 files · 14 min (Ann, Bob)');
    vi.advanceTimersByTime(60 * 60_000);
    expect(sourceControl.statusBarItems[0].title).toBe('Not in GitLab: 3 files · 1 h 14 min (Ann, Bob)');

    meta.set('changes', null);
    expect(sourceControl.resourceStates).toEqual([]);
    const clean = changes();
    vi.advanceTimersByTime(10 * 60_000);
    expect(changes()).toBe(clean);
    sourceControl.dispose();
  });

  it('shows a conflict with upstream as long as the room has it: "!" on its files, a warning entry first', () => {
    const { meta, sourceControl } = setup();
    meta.set('baseSha', '0123456789abcdef');
    meta.set('changes', { files: [{ path: '/main.typ', kind: 'modified' }, { path: '/a.typ', kind: 'added' }], since: Date.now(), editors: ['Ann'] });
    meta.set('conflict', { sha: 'fedcba9876543210', paths: ['/main.typ'] });
    expect(sourceControl.resourceStates.map((state) => [state.path, state.decorations.badge])).toEqual([
      ['/main.typ', '!'],
      ['/a.typ', 'A'],
    ]);
    const [warning, changes] = sourceControl.statusBarItems;
    expect(warning).toEqual({ title: 'Conflict with GitLab: main.typ', tooltip: expect.stringContaining('commit fedcba98'), backgroundColor: 'warning' });
    expect(changes.title).toBe('Not in GitLab: 2 files · < 1 min (Ann)');
    meta.set('conflict', { sha: 's', paths: ['/a.typ', '/b.typ', '/c.typ'] });
    expect(sourceControl.statusBarItems[0].title).toBe('Conflict with GitLab: a.typ, b.typ and 1 more');
    meta.set('conflict', null);
    expect(sourceControl.statusBarItems.map((command) => command.title)).toEqual(['Not in GitLab: 2 files · < 1 min (Ann)']);
    expect(sourceControl.resourceStates.map((state) => state.decorations.badge)).toEqual(['M', 'A']);
  });

  it('shows a failed commit as a warning entry until the server clears it, after a conflict\'s', () => {
    vi.useFakeTimers({ now: T0 + 3 * 60_000, toFake: ['setInterval', 'clearInterval', 'Date'] });
    const { meta, sourceControl } = setup();
    meta.set('baseSha', '0123456789abcdef');
    meta.set('changes', { files: [{ path: '/main.typ', kind: 'modified' }], since: T0, editors: ['Ann'] });
    meta.set('commitFailure', { message: 'GitLab could not be reached (fetch failed)', at: T0 });
    expect(sourceControl.statusBarItems).toEqual([
      {
        title: 'Saving to GitLab failed',
        tooltip: 'The last save to GitLab (3 min ago) failed:\nGitLab could not be reached (fetch failed)\nThe changes stay here. Click to try again.',
        backgroundColor: 'warning',
      },
      expect.objectContaining({ title: 'Not in GitLab: 1 file · 3 min (Ann)' }),
    ]);
    meta.set('conflict', { sha: 's', paths: ['/main.typ'] });
    expect(sourceControl.statusBarItems.map((command) => command.title)).toEqual([
      'Conflict with GitLab: main.typ',
      'Saving to GitLab failed',
      'Not in GitLab: 1 file · 3 min (Ann)',
    ]);
    meta.set('conflict', null);
    meta.set('commitFailure', { message: 42 });
    expect(sourceControl.statusBarItems.map((command) => command.title)).toEqual(['Not in GitLab: 1 file · 3 min (Ann)']);
    meta.set('commitFailure', null);
    expect(sourceControl.statusBarItems).toHaveLength(1);
    sourceControl.dispose();
  });

  it('knows when its changes stay uncommitted: there are some, and the server does not (or cannot) commit them by itself', () => {
    const { meta, sourceControl } = setup();
    meta.set('autoCommit', null);
    expect(sourceControl.changesStayUncommitted).toBe(false);
    meta.set('changes', { files: [{ path: '/main.typ', kind: 'modified' }], since: Date.now(), editors: [] });
    expect(sourceControl.changesStayUncommitted).toBe(true);
    meta.set('autoCommit', 10);
    expect(sourceControl.changesStayUncommitted).toBe(false);
    // a conflict blocks the server's commits
    meta.set('conflict', { sha: 's', paths: ['/main.typ'] });
    expect(sourceControl.changesStayUncommitted).toBe(true);
    meta.set('conflict', null);
    expect(sourceControl.changesStayUncommitted).toBe(false);
    // so does a failed commit (GitLab unreachable)
    meta.set('commitFailure', { message: 'down', at: 1 });
    expect(sourceControl.changesStayUncommitted).toBe(true);
    meta.set('commitFailure', null);
    expect(sourceControl.changesStayUncommitted).toBe(false);
  });

  it('ignores changes it cannot read', () => {
    const { meta, sourceControl } = setup();
    meta.set('baseSha', 'abc');
    meta.set('changes', { files: 'x', since: 1, editors: [] });
    expect(sourceControl.statusBarItems[0].title).toBe('Saved · abc');
    meta.set('changes', { files: [{ path: 'no-slash', kind: 'added' }], since: Date.now(), editors: [] });
    expect(sourceControl.resourceStates).toEqual([]);
    expect(sourceControl.statusBarItems[0].title).toBe('Not in GitLab: 1 file · < 1 min');
  });
});

describe('GitLabSourceControl messages', () => {
  /** What it told after the server sent `message`. */
  function statusAfter(message: object) {
    const { receive, told } = setup();
    receive(JSON.stringify(message));
    return told[0];
  }

  it('says when there was nothing to save, upstream was merged, or saving failed', () => {
    expect(statusAfter({ type: 'gitlab:unchanged' })).toEqual({ message: 'No changes to save', severity: 'info' });
    expect(statusAfter({ type: 'gitlab:merged', sha: 's' })).toEqual({ message: 'Merged new changes from GitLab', severity: 'info' });
    expect(statusAfter({ type: 'gitlab:error', message: 'no token' })).toEqual({ message: 'Saving failed: no token', severity: 'error' });
  });

  it('lists the conflicting files', () => {
    const files = [{ path: '/main.typ', ranges: [] }, { path: '/a.typ', ranges: [{ from: 0, to: 1 }] }];
    expect(statusAfter({ type: 'gitlab:conflict', sha: 's', files })).toEqual({ message: 'Changes on GitLab conflict with edits in /main.typ, /a.typ; not saved', severity: 'warning' });
  });
});

describe('GitLabSourceControl: quick diff', () => {
  it('gives a file\'s text at the last commit, \'\' for a file added since, and tells when the base moves', () => {
    const { meta, sourceControl, changes } = setup();
    const path = ProjectPath.of('/main.typ');
    expect(sourceControl.quickDiffProvider.provideOriginalText(path)).toBe('');
    meta.set('base', { '/main.typ': '= Intro\n' });
    expect(sourceControl.quickDiffProvider.provideOriginalText(path)).toBe('= Intro\n');
    expect(sourceControl.quickDiffProvider.provideOriginalText(ProjectPath.of('/new.typ'))).toBe('');
    expect(changes()).toBe(1);
  });
});
