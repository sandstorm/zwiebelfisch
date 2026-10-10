import type { CompileResult, Jump, Position } from '../engine/engine';

/**
 * First message to the worker: where the engine wasm is. The main thread
 * resolves the URL, so the worker file references no other asset and a
 * consumer's bundler sees the wasm next to the main module.
 */
export interface Init {
  type: 'init';
  wasm: string;
}

/** Messages between Preview (main thread) and the engine worker. */
export type Request =
  | { id: number; type: 'compile'; files: Record<string, string>; main: string }
  | { id: number; type: 'click'; page: number; x: number; y: number }
  | { id: number; type: 'cursor'; path: string; offset: number };

export type Response =
  | { id: number; type: 'compile'; result: CompileResult }
  | { id: number; type: 'click'; jump: Jump | null }
  | { id: number; type: 'cursor'; positions: Position[] }
  | { id: number; type: 'error'; message: string };
