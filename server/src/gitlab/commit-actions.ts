// The GitLab commit actions (create, update, delete, move) that turn a repository tree into the room's files. See gitlab-room.ts.
import type { ChangedFile, RoomMeta } from '../../../src/core/room-protocol/room-protocol.ts';
import { blobSha } from './blob-sha.ts';
import type { CommitAction } from './gitlab-api.ts';

/** The room's files as they are now: `.typ` texts, and the other files (blob sha, or uploaded bytes). */
export interface RoomFiles {
  texts: Record<string, string>;
  assets: Record<string, string | Uint8Array>;
}

/**
 * The actions of one commit that turns the repository at the room's base
 * into the room's files: updates, creations, deletions, and moves (a deleted
 * file paired with a created one of similar content, like git's rename
 * detection). Updates, moves and deletions of `.typ` files carry the commit
 * that last changed the file, so GitLab refuses them if it changed upstream.
 */
export function commitActions(meta: RoomMeta, files: RoomFiles): CommitAction[] {
  return [...textActions(meta, files.texts), ...assetActions(meta.baseAssets, files.assets)];
}

/** The files a commit of `actions` changes, by path (a move: its old path deleted, its new one added). */
export function changedFiles(actions: readonly CommitAction[]): ChangedFile[] {
  const kinds = { create: 'added', update: 'modified', delete: 'deleted', move: 'added' } as const;
  const files: ChangedFile[] = actions.map((action) => ({ path: action.path, kind: kinds[action.action] }));
  for (const action of actions) if (action.action === 'move') files.push({ path: action.previousPath, kind: 'deleted' });
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function textActions(meta: RoomMeta, texts: Record<string, string>): CommitAction[] {
  const { base, lastCommits } = meta;
  const actions: CommitAction[] = [];
  const created = Object.keys(texts).filter((path) => !(path in base));
  const deleted = Object.keys(base).filter((path) => !(path in texts));
  for (const [path, text] of Object.entries(texts)) {
    if (path in base && base[path] !== text) actions.push({ action: 'update', path, content: text, lastCommitId: lastCommits[path] });
  }
  for (const [from, to] of pairRenames(deleted, created, (a, b) => similarity(base[a], texts[b]))) {
    actions.push({ action: 'move', path: to, previousPath: from, content: texts[to], lastCommitId: lastCommits[from] });
    deleted.splice(deleted.indexOf(from), 1);
    created.splice(created.indexOf(to), 1);
  }
  for (const path of created) actions.push({ action: 'create', path, content: texts[path] });
  for (const path of deleted) actions.push({ action: 'delete', path, lastCommitId: lastCommits[path] });
  return actions;
}

function assetActions(base: Record<string, string>, assets: Record<string, string | Uint8Array>): CommitAction[] {
  const actions: CommitAction[] = [];
  const deleted = Object.keys(base).filter((path) => !(path in assets));
  for (const [path, value] of Object.entries(assets)) {
    const action = assetAction(base, deleted, path, value);
    if (action) actions.push(action);
  }
  for (const path of deleted) actions.push({ action: 'delete', path });
  return actions;
}

/** The action for one of the room's other files, if it changed; a rename takes its source out of `deleted`. */
function assetAction(base: Record<string, string>, deleted: string[], path: string, value: string | Uint8Array): CommitAction | null {
  if (typeof value !== 'string') {
    if (base[path] === blobSha(value)) return null;
    return { action: path in base ? 'update' : 'create', path, content: value };
  }
  if (base[path] === value) return null;
  // A repository file under a new path: a rename (moved without new content).
  const source = deleted.findIndex((old) => base[old] === value);
  if (source < 0) return null;
  const [from] = deleted.splice(source, 1);
  return { action: 'move', path, previousPath: from };
}

/** Pairs of (deleted, created) paths whose contents are similar enough to call it a rename; best pairs first. */
function pairRenames(deleted: string[], created: string[], score: (from: string, to: string) => number): [string, string][] {
  const candidates = deleted.flatMap((from) => created.map((to) => ({ from, to, score: score(from, to) })));
  candidates.sort((a, b) => b.score - a.score);
  const pairs: [string, string][] = [];
  const used = new Set<string>();
  for (const { from, to, score: value } of candidates) {
    if (value < RENAME_THRESHOLD || used.has(from) || used.has(to)) continue;
    used.add(from).add(to);
    pairs.push([from, to]);
  }
  return pairs;
}

/** git's default: at least half the content is the same. */
const RENAME_THRESHOLD = 0.5;

/** How much of two texts' lines they share (0..1; identical texts 1, also when empty). */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const left = a.split('\n');
  const right = b.split('\n');
  const counts = new Map<string, number>();
  for (const line of left) counts.set(line, (counts.get(line) ?? 0) + 1);
  let shared = 0;
  for (const line of right) {
    const count = counts.get(line) ?? 0;
    if (count > 0) {
      shared++;
      counts.set(line, count - 1);
    }
  }
  return (2 * shared) / (left.length + right.length);
}
