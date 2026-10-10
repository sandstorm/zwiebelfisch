import type { Box, CompileResult, Jump, Position } from '../core/typst-engine/typst-engine';
import type { EncodedFiles } from './project-files';

/**
 * First message to the worker: where the engine wasm and fonts are. The main thread
 * resolves the URL, so the worker file references no other asset and a
 * consumer's bundler sees the wasm next to the main module.
 */
export interface Init {
  type: 'init';
  wasm: string;
  /** Font files to load before the first compile. */
  fonts: readonly string[];
}

/** Messages between Preview (main thread) and the engine worker. */
export type Request =
  | { id: number; type: 'compile'; files: EncodedFiles; main: string }
  | { id: number; type: 'click'; page: number; x: number; y: number }
  | { id: number; type: 'cursor'; path: string; offset: number }
  | { id: number; type: 'boxes'; path: string; ranges: { from: number; to: number }[] };

export type Response =
  | { id: number; type: 'compile'; result: CompileResult }
  | { id: number; type: 'click'; jump: Jump | null }
  | { id: number; type: 'cursor'; positions: Position[] }
  | { id: number; type: 'boxes'; boxes: Box[] }
  | { id: number; type: 'error'; message: string };
