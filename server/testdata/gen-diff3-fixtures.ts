// Writes server/lib/diff3/testdata/node-diff3.json: three-way merges and diffs computed by node-diff3 (what the
// TypeScript server merged rooms with), for random line sequences. The Go port (server/lib/diff3) must give the
// same results (TestNodeDiff3Fixtures). Regenerate: `node server/testdata/gen-diff3-fixtures.ts`, then commit the
// JSON (it needs node-diff3 from server/node_modules).
import { writeFileSync } from 'node:fs';
import { diff3Merge, diffPatch } from 'node-diff3';

// A seeded generator (mulberry32), so the fixtures only change when this script does.
let seed = 20261013;
function random(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];

// Few distinct lines, so that sequences share many of them (repeats are where LCS choices differ).
const LINES = ['a', 'b', 'c', 'd', 'e', '', '= Title', 'x'];

function sequence(length: number): string[] {
  return Array.from({ length }, () => pick(LINES));
}

/** `base` with a few random edits: replace, insert or delete lines. */
function edit(base: string[]): string[] {
  const result = [...base];
  const edits = Math.floor(random() * 4);
  for (let i = 0; i < edits; i++) {
    const at = Math.floor(random() * (result.length + 1));
    const kind = pick(['replace', 'insert', 'delete']);
    if (kind === 'insert' || result.length === 0) result.splice(at, 0, pick(LINES));
    else if (kind === 'delete') result.splice(Math.min(at, result.length - 1), 1);
    else result[Math.min(at, result.length - 1)] = pick(LINES);
  }
  return result;
}

const cases = [];
for (let i = 0; i < 400; i++) {
  const o = sequence(Math.floor(random() * 12));
  const a = random() < 0.1 ? [...o] : edit(o);
  const b = random() < 0.1 ? [...a] : edit(o);
  cases.push({
    a,
    o,
    b,
    merge: diff3Merge(a, o, b),
    patch: diffPatch(o, a).map(({ buffer1, buffer2 }) => [buffer1.offset, buffer1.length, buffer2.offset, buffer2.length]),
  });
}
writeFileSync(new URL('../lib/diff3/testdata/node-diff3.json', import.meta.url), JSON.stringify(cases, null, 0) + '\n');
