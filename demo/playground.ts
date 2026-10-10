import type { CollaborationOptions, ProjectFiles } from '../src';
import { exampleFiles, exampleFromQuery, exampleQuery, type ExampleName } from './examples';

/**
 * The demo playground's state, all of it in the URL (so a second window, a
 * reload or a shared link shows the same):
 *
 * | parameter  | |
 * |------------|---|
 * | `example`  | hello / simple / advanced (see examples.ts) |
 * | `room`     | none: Local mode; `gitlab:…`: GitLab mode; else Collaborate mode in that room |
 * | `user`     | the name others see (default Ann in a room, so the second window can be Bob) |
 *
 * The rooms live on the local collaboration server (`mise run demo`).
 */
export type Mode = 'local' | 'collab' | 'gitlab';

export const MODES: readonly { mode: Mode; label: string }[] = [
  { mode: 'local', label: 'Local' },
  { mode: 'collab', label: 'Collaborate' },
  { mode: 'gitlab', label: 'GitLab (fake)' },
];

/** The playground server (server/src/fake-gitlab-main.ts, PORT 1234). */
export const SERVER = { ws: 'ws://127.0.0.1:1234', http: 'http://127.0.0.1:1234' } as const;

/** The fake GitLab's repository (server/src/playground/playground.ts: PLAYGROUND_ROOM). */
export const GITLAB_ROOM = 'gitlab:demo/report@main';

const GITLAB_PREFIX = 'gitlab:';
const ROOM_PREFIX = 'playground-';
const USERS = ['Ann', 'Bob', 'Cleo', 'Dan'];

export interface PlaygroundState {
  example: ExampleName;
  mode: Mode;
  room: string | null;
  user: string;
}

/** Whether the playground server answered: with its fake GitLab, without it (`mise run server:dev`), or not at all. */
export type ServerKind = 'gitlab' | 'plain' | 'offline';

export function playgroundFromQuery(params: URLSearchParams): PlaygroundState {
  const room = params.get('room') || null;
  return {
    example: exampleFromQuery(params),
    mode: room === null ? 'local' : room.startsWith(GITLAB_PREFIX) ? 'gitlab' : 'collab',
    room,
    user: params.get('user') || (room === null ? 'Demo user' : USERS[0]),
  };
}

/** The query that switches to `mode`, keeping example and user. */
export function modeQuery(mode: Mode, params: URLSearchParams): string {
  const next = new URLSearchParams(params);
  if (mode === 'local') next.delete('room');
  else next.set('room', mode === 'gitlab' ? GITLAB_ROOM : ROOM_PREFIX + exampleFromQuery(params));
  return `?${next}`;
}

/** The query that switches to example `name`; a playground room follows to that example's room. */
export function exampleLink(name: ExampleName, params: URLSearchParams): string {
  const next = new URLSearchParams(exampleQuery(name, params));
  if (next.get('room')?.startsWith(ROOM_PREFIX)) next.set('room', ROOM_PREFIX + name);
  return `?${next}`;
}

export function userQuery(user: string, params: URLSearchParams): string {
  const next = new URLSearchParams(params);
  next.set('user', user);
  return `?${next}`;
}

/** Someone else to be in the second window. */
export function otherUser(name: string): string {
  const at = USERS.indexOf(name);
  return at < 0 ? USERS[1] : USERS[(at + 1) % USERS.length];
}

/**
 * The widget options for `state`, once it is known whether the server is
 * there (`null` in Local mode, which never asks). Without a server a room
 * falls back to a local copy of the example; the bar says so.
 */
export function editorOptions(state: PlaygroundState, server: ServerKind | null): { files: ProjectFiles; collaboration?: CollaborationOptions } {
  if (state.room === null || server === null || server === 'offline') return { files: exampleFiles(state.example) };
  const collaboration = { url: SERVER.ws, room: state.room };
  // A GitLab room is loaded from the repository; local files would only shadow its images.
  return { files: state.mode === 'gitlab' ? {} : exampleFiles(state.example), collaboration };
}
