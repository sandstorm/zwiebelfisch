// Tests for gitlab-source-control.ts.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { META_MAP } from '../../../core/gitlab-protocol/gitlab-protocol';
import { commitStatus, GitLabSourceControl } from './gitlab-source-control';

function setup() {
  const sent: string[] = [];
  const listeners = new Set<(payload: string) => void>();
  const channel = {
    send: (payload: string) => void sent.push(payload),
    listen(listener: (payload: string) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const receive = (payload: string) => listeners.forEach((listener) => listener(payload));
  const sourceControl = new GitLabSourceControl(channel, { name: 'Ann' });
  let changes = 0;
  sourceControl.onDidChange(() => changes++);
  return { sent, receive, sourceControl, changes: () => changes };
}

describe('GitLabSourceControl', () => {
  it('knows a GitLab-backed room by its last commit', () => {
    const ydoc = new Y.Doc();
    expect(GitLabSourceControl.isGitLabRoom(ydoc)).toBe(false);
    ydoc.getMap(META_MAP).set('baseSha', 'abc');
    expect(GitLabSourceControl.isGitLabRoom(ydoc)).toBe(true);
  });

  it('commits as its author, busy until the server answers, which becomes the status', () => {
    const { sent, receive, sourceControl, changes } = setup();
    expect(sourceControl).toMatchObject({ id: 'gitlab', label: 'GitLab', defaultCommitMessage: 'Edit via Typst editor' });
    sourceControl.commit('Fix typo');
    expect(JSON.parse(sent[0])).toEqual({ type: 'gitlab:save', message: 'Fix typo', author: { name: 'Ann' } });
    expect(sourceControl.state).toEqual({ busy: true, status: 'Saving…' });
    receive('{"type":"gitlab:merged","sha":"s"}');
    expect(sourceControl.state).toEqual({ busy: true, status: 'Merged new changes from GitLab' });
    receive('{"type":"other"}');
    receive('not json');
    receive('{"type":"gitlab:saved","sha":"0123456789abcdef","author":"Ann"}');
    expect(sourceControl.state).toEqual({ busy: false, status: 'Saved version 01234567 (Ann)' });
    expect(changes()).toBe(3);
  });
});

describe('commitStatus', () => {
  it('says when there was nothing to save, upstream was merged, or saving failed', () => {
    expect(commitStatus({ type: 'gitlab:unchanged' })).toBe('No changes to save');
    expect(commitStatus({ type: 'gitlab:merged', sha: 's' })).toBe('Merged new changes from GitLab');
    expect(commitStatus({ type: 'gitlab:error', message: 'no token' })).toBe('Saving failed: no token');
  });

  it('lists the conflicting files', () => {
    const files = [{ path: '/main.typ', ranges: [] }, { path: '/a.typ', ranges: [{ from: 0, to: 1 }] }];
    expect(commitStatus({ type: 'gitlab:conflict', sha: 's', files })).toBe('Changes on GitLab conflict with edits in /main.typ, /a.typ; not saved');
  });
});
