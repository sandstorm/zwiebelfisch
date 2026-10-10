import { diff3Merge, diffPatch } from 'node-diff3';
import type { ConflictRange, FileConflict } from '../../../src/collab/gitlab-protocol.ts';

/** A replacement in pre-change coordinates (UTF-16). */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

/** The lines of `text`, each with its line break (so joining them gives `text` back). */
function lines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

const length = (parts: string[]) => parts.reduce((sum, part) => sum + part.length, 0);

/**
 * Three-way merge by lines (diff3): the changes from `base` to `current` and
 * from `base` to `upstream`, combined. Where both changed the same lines
 * differently, the result is the conflicting ranges of `current` instead.
 */
export function merge3(base: string, current: string, upstream: string): { merged: string } | { conflicts: ConflictRange[] } {
  const ours = lines(current);
  const regions = diff3Merge(ours, lines(base), lines(upstream));
  const conflicts: ConflictRange[] = [];
  const merged: string[] = [];
  for (const region of regions) {
    if (region.ok) merged.push(...region.ok);
    else if (region.conflict) {
      const from = length(ours.slice(0, region.conflict.aIndex));
      conflicts.push({ from, to: from + length(region.conflict.a) });
    }
  }
  return conflicts.length ? { conflicts } : { merged: merged.join('') };
}

/**
 * Small edits that turn `from` into `to`: changed lines, each narrowed to
 * the characters that differ, so text around them (and positions anchored
 * there, like other users' cursors) stays untouched. Ascending, non-overlapping.
 */
export function textEdits(from: string, to: string): TextEdit[] {
  const a = lines(from);
  const b = lines(to);
  return diffPatch(a, b).map(({ buffer1, buffer2 }) => {
    const start = length(a.slice(0, buffer1.offset));
    return narrow(start, buffer1.chunk.join(''), buffer2.chunk.join(''));
  });
}

/** The edit replacing `removed` (at `start`) by `inserted`, without their common prefix and suffix. */
function narrow(start: number, removed: string, inserted: string): TextEdit {
  let prefix = 0;
  const max = Math.min(removed.length, inserted.length);
  while (prefix < max && removed[prefix] === inserted[prefix]) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && removed[removed.length - 1 - suffix] === inserted[inserted.length - 1 - suffix]) suffix++;
  return { from: start + prefix, to: start + removed.length - suffix, insert: inserted.slice(prefix, inserted.length - suffix) };
}

/** `text` with `edits` (ascending, pre-change coordinates) applied. */
export function applyEdits(text: string, edits: TextEdit[]): string {
  let result = text;
  for (const edit of [...edits].reverse()) result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
  return result;
}

type Texts = Record<string, string>;

/**
 * Merges upstream's changes to a set of files (path → text) into the room's
 * files: `changes` is what to do to `current` (new text, or null: delete).
 * A file changed on both sides is merged with `merge3`; a file changed on one
 * side and deleted on the other is a conflict as a whole.
 */
export function mergeFiles(base: Texts, current: Texts, upstream: Texts): { changes: Record<string, string | null>; conflicts: FileConflict[] } {
  const changes: Record<string, string | null> = {};
  const conflicts: FileConflict[] = [];
  const paths = new Set([...Object.keys(base), ...Object.keys(current), ...Object.keys(upstream)]);
  for (const path of [...paths].sort()) {
    const [b, c, u] = [base[path], current[path], upstream[path]];
    if (u === b || c === u) continue;
    if (c === b) {
      changes[path] = u ?? null;
      continue;
    }
    if (c === undefined || u === undefined) {
      conflicts.push({ path, ranges: [] });
      continue;
    }
    const result = merge3(b ?? '', c, u);
    if ('merged' in result) changes[path] = result.merged;
    else conflicts.push({ path, ranges: result.conflicts });
  }
  return { changes, conflicts };
}
