import { describe, expect, it } from 'vitest';
import { editorHref, parseGitLabLocation, roomOf } from './gitlab-location';

describe('parseGitLabLocation', () => {
  it('reads a room', () => {
    expect(parseGitLabLocation('gitlab:group/p@main')).toEqual({ project: 'group/p', branch: 'main' });
    expect(parseGitLabLocation(' gitlab:group/sub/p@feature-x:/2026/q1 ')).toEqual({ project: 'group/sub/p', branch: 'feature-x', folder: '/2026/q1' });
    expect(parseGitLabLocation('gitlab:group/p')).toBeNull();
  });

  it('reads a project page', () => {
    expect(parseGitLabLocation('https://gitlab.example.org/group/sub/p')).toEqual({ project: 'group/sub/p' });
    expect(parseGitLabLocation('https://gitlab.example.org/group/p/-/merge_requests')).toEqual({ project: 'group/p' });
  });

  it('reads a tree or a file: the branch and the folder', () => {
    expect(parseGitLabLocation('https://gitlab.example.org/group/p/-/tree/main')).toEqual({ project: 'group/p', branch: 'main' });
    expect(parseGitLabLocation('https://gitlab.example.org/group/p/-/tree/main/2026/q1?ref_type=heads')).toEqual({
      project: 'group/p', branch: 'main', folder: '/2026/q1',
    });
    expect(parseGitLabLocation('https://gitlab.example.org/group/p/-/blob/main/2026/q1/main.typ')).toEqual({
      project: 'group/p', branch: 'main', folder: '/2026/q1',
    });
    expect(parseGitLabLocation('https://gitlab.example.org/group/p/-/blob/main/main.typ')).toEqual({ project: 'group/p', branch: 'main' });
  });

  it('refuses what names no project', () => {
    for (const input of ['', 'hello', 'https://gitlab.example.org/', 'https://gitlab.example.org/group', 'ftp://x/group/p']) {
      expect(parseGitLabLocation(input), input).toBeNull();
    }
  });
});

describe('roomOf', () => {
  it('leaves out the root folder', () => {
    expect(roomOf({ project: 'group/p', branch: 'main', folder: '/' })).toBe('gitlab:group/p@main');
    expect(roomOf({ project: 'group/p', branch: 'main', folder: '/2026/q1' })).toBe('gitlab:group/p@main:/2026/q1');
  });

  it('is the editor address', () => {
    expect(editorHref('gitlab:group/p@main')).toBe('/edit?room=gitlab%3Agroup%2Fp%40main');
  });
});
