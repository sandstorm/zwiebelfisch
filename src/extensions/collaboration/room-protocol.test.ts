// Tests for room-protocol.ts.
import { describe, expect, it } from 'vitest';
import { gitlabRoom } from './room-protocol';

describe('gitlabRoom', () => {
  it('reads project, branch and folder of a GitLab room; null for any other room', () => {
    expect(gitlabRoom('gitlab:group/report@main')).toEqual({ project: 'group/report', branch: 'main', folder: null });
    expect(gitlabRoom('gitlab:42@feature/x:/reports/q1')).toEqual({ project: '42', branch: 'feature/x', folder: '/reports/q1' });
    expect([gitlabRoom('plain-room'), gitlabRoom('gitlab:no-branch'), gitlabRoom('gitlab:@main')]).toEqual([null, null, null]);
  });
});
