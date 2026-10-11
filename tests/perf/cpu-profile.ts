// A V8 CPU profile of this thread, summed up by our modules and functions. See typing.perf.ts.
import { Session } from 'node:inspector/promises';

/** A V8 CPU profile (`.cpuprofile`: Chrome DevTools' Performance panel opens it). */
export interface CpuProfile {
  nodes: { id: number; parent?: number; children?: number[]; callFrame: { functionName: string; url: string; lineNumber: number } }[];
  samples: number[];
  timeDeltas: number[];
  startTime: number;
  endTime: number;
}

/** Profiles this thread from `start()` until `stop()`, sampling every 100 µs. */
export class Profiler {
  private readonly session = new Session();

  async start(): Promise<void> {
    this.session.connect();
    await this.session.post('Profiler.enable');
    await this.session.post('Profiler.setSamplingInterval', { interval: 100 });
    await this.session.post('Profiler.start');
  }

  async stop(): Promise<CpuProfile> {
    const { profile } = (await this.session.post('Profiler.stop')) as { profile: CpuProfile };
    this.session.disconnect();
    return profile;
  }
}

/** Where a profile's time went, in milliseconds. */
export interface ProfileSummary {
  /** Time this thread ran JavaScript, the engine left out (see `isEngine`). */
  mainThread: number;
  /** Time in the engine: a browser spends it on the worker's thread. */
  engine: number;
  /** `mainThread` by the innermost frame of ours on the stack (library code counts for the code of ours calling it). */
  byModule: [string, number][];
  /** Time with each function of ours on the stack (inclusive; a function counted once per sample). */
  byFunction: [string, number][];
  /** `byFunction` of the time spent inside the function named by `summarize`'s `within`. */
  keystroke: { byFunction: [string, number][] };
}

/** Sums `profile` up: `mainThread` by module and by function, the engine apart, and the time inside function `within`. */
export function summarize(profile: CpuProfile, root: string, within: string): ProfileSummary {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of profile.nodes) for (const child of node.children ?? []) parents.set(child, node.id);
  const byModule = new Map<string, number>();
  const byFunction = new Map<string, number>();
  const inside = new Map<string, number>();
  let mainThread = 0;
  let engine = 0;
  profile.samples.forEach((id, index) => {
    const ms = (profile.timeDeltas[index + 1] ?? 0) / 1000;
    const stack = stackOf(id, nodes, parents);
    if (stack.length === 0 || IDLE.has(stack[0].functionName)) return;
    if (stack.some(isEngine)) {
      engine += ms;
      return;
    }
    mainThread += ms;
    const ours = stack.filter((frame) => frame.url.includes(root) && !frame.url.includes('node_modules'));
    add(byModule, ours[0] ? moduleOf(ours[0].url, root) : libraryOf(stack[0].url), ms);
    const names = new Set(ours.map((frame) => `${frame.functionName || '(anonymous)'} ${fileOf(frame.url, root)}:${frame.lineNumber + 1}`));
    const keystroke = stack.some((frame) => frame.functionName === within);
    for (const name of names) {
      add(byFunction, name, ms);
      if (keystroke) add(inside, name, ms);
    }
  });
  return { mainThread, engine, byModule: sorted(byModule), byFunction: sorted(byFunction), keystroke: { byFunction: sorted(inside) } };
}

const IDLE = new Set(['(idle)', '(program)', '(garbage collector)', '(root)']);

/** A frame of what runs on the worker's thread in a browser: the stand-in, the engine (wasm) and its packages. */
function isEngine(frame: CpuProfile['nodes'][number]['callFrame']): boolean {
  return frame.functionName === 'engineThread' || frame.url.startsWith('wasm') || /src\/core\/typst-(engine|packages)\//.test(frame.url);
}

/** The frames of node `id`, innermost first. */
function stackOf(id: number, nodes: Map<number, CpuProfile['nodes'][number]>, parents: Map<number, number>): CpuProfile['nodes'][number]['callFrame'][] {
  const stack = [];
  for (let at: number | undefined = id; at !== undefined; at = parents.get(at)) stack.push(nodes.get(at)!.callFrame);
  return stack;
}

function add(map: Map<string, number>, key: string, ms: number): void {
  map.set(key, (map.get(key) ?? 0) + ms);
}

function sorted(map: Map<string, number>): [string, number][] {
  return [...map].sort((a, b) => b[1] - a[1]);
}

function fileOf(url: string, root: string): string {
  return url.slice(url.indexOf(root) + root.length).replace(/\?.*$/, '');
}

/** `src/extensions/labels/…` → `extensions/labels`; `src/hosts/visual-editor/nodes/…` → `hosts/visual-editor/nodes`. */
function moduleOf(url: string, root: string): string {
  const parts = fileOf(url, root).split('/');
  if (parts[0] !== 'src') return parts.slice(0, -1).join('/');
  return parts.slice(1, Math.min(parts.length - 1, 4)).join('/');
}

function libraryOf(url: string): string {
  const match = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/.exec(url);
  return match ? `(${match[1]})` : url ? '(other)' : '(native)';
}
