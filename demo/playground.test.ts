// Tests for playground.ts.
import { describe, expect, it } from 'vitest';
import { exampleFiles } from './examples';
import { GITLAB_ROOM, SERVER, editorOptions, exampleLink, modeQuery, otherUser, playgroundFromQuery, userQuery } from './playground';

const query = (search: string) => new URLSearchParams(search);
const parsed = (search: string) => Object.fromEntries(new URLSearchParams(search));

describe('playgroundFromQuery', () => {
  it('is local without a room: the static e2e build needs no server', () => {
    expect(playgroundFromQuery(query(''))).toEqual({ example: 'simple', mode: 'local', room: null, user: 'Demo user' });
  });

  it('a plain room collaborates, a gitlab: room is GitLab mode', () => {
    expect(playgroundFromQuery(query('?room=r1&user=Bob'))).toMatchObject({ mode: 'collab', room: 'r1', user: 'Bob' });
    expect(playgroundFromQuery(query(`?room=${encodeURIComponent(GITLAB_ROOM)}`))).toMatchObject({ mode: 'gitlab', room: GITLAB_ROOM });
  });

  it('a room without ?user joins as Ann', () => {
    expect(playgroundFromQuery(query('?room=r1')).user).toBe('Ann');
  });

  it('keeps the example', () => {
    expect(playgroundFromQuery(query('?example=advanced&room=r1')).example).toBe('advanced');
  });
});

describe('modeQuery', () => {
  it('Local drops the room and keeps the rest', () => {
    expect(parsed(modeQuery('local', query('?example=simple&room=r1&user=Bob')))).toEqual({ example: 'simple', user: 'Bob' });
  });

  it('Collaborate joins the playground room of the current example', () => {
    expect(parsed(modeQuery('collab', query('?example=simple')))).toEqual({ example: 'simple', room: 'playground-simple' });
    expect(parsed(modeQuery('collab', query('')))).toEqual({ room: 'playground-simple' });
  });

  it('GitLab joins the fake repository', () => {
    expect(parsed(modeQuery('gitlab', query('?user=Ada')))).toEqual({ user: 'Ada', room: GITLAB_ROOM });
  });
});

describe('exampleLink', () => {
  it('moves along to the new example’s playground room', () => {
    expect(parsed(exampleLink('advanced', query('?room=playground-simple&user=Ann')))).toEqual({
      room: 'playground-advanced',
      user: 'Ann',
      example: 'advanced',
    });
  });

  it('keeps a room someone named themselves', () => {
    expect(parsed(exampleLink('simple', query('?room=team')))).toEqual({ room: 'team', example: 'simple' });
  });
});

describe('users', () => {
  it('the second window is another user in the same room', () => {
    expect(parsed(userQuery(otherUser('Ann'), query('?room=r1&user=Ann')))).toEqual({ room: 'r1', user: 'Bob' });
  });

  it('otherUser cycles through a few names and falls back to Bob', () => {
    expect(otherUser('Bob')).toBe('Cleo');
    expect(otherUser('Dan')).toBe('Ann');
    expect(otherUser('Zoë')).toBe('Bob');
  });
});

describe('editorOptions', () => {
  const state = (search: string) => playgroundFromQuery(query(search));

  it('local mode edits the example, without a server', () => {
    expect(editorOptions(state('?example=simple'), null)).toEqual({ files: exampleFiles('simple') });
  });

  it('collaborate mode seeds the room with the example', () => {
    expect(editorOptions(state('?room=r1'), 'server')).toEqual({
      files: exampleFiles('simple'),
      collaboration: { url: SERVER.ws, room: 'r1' },
    });
  });

  it('GitLab mode takes everything from the repository', () => {
    expect(editorOptions(state(`?room=${encodeURIComponent(GITLAB_ROOM)}`), 'gitlab')).toEqual({
      files: {},
      collaboration: { url: SERVER.ws, room: GITLAB_ROOM },
    });
  });


  it('falls back to a local copy of the example when the server is not reachable', () => {
    expect(editorOptions(state(`?room=${encodeURIComponent(GITLAB_ROOM)}`), 'offline')).toEqual({ files: exampleFiles('simple') });
  });
});
