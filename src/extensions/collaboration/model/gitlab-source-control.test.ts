// Tests for gitlab-source-control.ts.
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { META_MAP } from '../../../core/gitlab-protocol/gitlab-protocol';
import { GitLabSourceControl } from './gitlab-source-control';

function setup() {
  const sent: string[] = [];
  const messages = new EventEmitter<string>();
  const channel = { send: (payload: string) => void sent.push(payload), onDidReceiveMessage: messages.event };
  const receive = (payload: string) => messages.fire(payload);
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

  it('commits as its author, busy until the server answers, whose answer becomes the status', () => {
    const { sent, receive, sourceControl, changes } = setup();
    expect(sourceControl).toMatchObject({ id: 'gitlab', label: 'GitLab', defaultCommitMessage: 'Edit via Typst editor' });
    sourceControl.commit('Fix typo');
    expect(JSON.parse(sent[0])).toEqual({ type: 'gitlab:save', message: 'Fix typo', author: { name: 'Ann' } });
    expect(sourceControl.state).toEqual({ busy: true, status: null });
    receive('{"type":"gitlab:merged","sha":"s"}');
    expect(sourceControl.state).toEqual({ busy: true, status: { message: 'Merged new changes from GitLab', severity: 'info' } });
    receive('{"type":"other"}');
    receive('not json');
    receive('{"type":"gitlab:saved","sha":"0123456789abcdef","author":"Ann"}');
    expect(sourceControl.state).toEqual({ busy: false, status: { message: 'Saved version 01234567 (Ann)', severity: 'info' } });
    expect(changes()).toBe(3);
  });
});

describe('GitLabSourceControl status', () => {
  /** The status after the server sent `message`. */
  function statusAfter(message: object) {
    const { receive, sourceControl } = setup();
    receive(JSON.stringify(message));
    return sourceControl.state.status;
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
