// The Typst engine's memory as the devtools show it. See devtools in ../devtools.ts.
import { ENGINE_MEMORY_LIMIT } from '../../../core/typst-engine/typst-engine';

/**
 * The engine's memory as the preview told it (`preview.engineMemory`): the latest `HISTORY` changes, oldest first,
 * and the most it held (more than now after a crash: the new engine starts small).
 */
export class EngineMemoryLog {
  #changes: MemoryChange[] = [];
  #peak = 0;

  /** The engine holds `bytes` now. */
  add(bytes: number, time = Date.now()): void {
    const before = this.current;
    this.#changes = [...this.#changes, { time, bytes, growth: bytes - before }].slice(-HISTORY);
    this.#peak = Math.max(this.#peak, bytes);
  }

  /** The bytes the engine holds; 0 before it compiled. */
  get current(): number {
    return this.#changes.at(-1)?.bytes ?? 0;
  }

  get changes(): readonly MemoryChange[] {
    return this.#changes;
  }

  /** One line: `Typst engine memory: 312 MB of 4 GB (8%)`, with the peak when it was more. */
  summary(): string {
    if (this.#changes.length === 0) return 'Typst engine memory: nothing compiled yet';
    const share = Math.round((this.current / ENGINE_MEMORY_LIMIT) * 100);
    const peak = this.#peak > this.current ? `, peak ${megabytes(this.#peak)}` : '';
    return `Typst engine memory: ${megabytes(this.current)} of ${ENGINE_MEMORY_LIMIT / GB} GB (${share}%)${peak}`;
  }
}

/** The engine's memory changed after a compile: to `bytes`, by `growth` (negative: a new engine). */
export interface MemoryChange {
  readonly time: number;
  readonly bytes: number;
  readonly growth: number;
}

/** `312 MB`, in binary units as the wasm's limit is (4 GB = 4096 MB). */
export function megabytes(bytes: number): string {
  return `${Math.round(bytes / MB)} MB`;
}

/** How many changes are kept. */
const HISTORY = 20;
const MB = 2 ** 20;
const GB = 2 ** 30;
