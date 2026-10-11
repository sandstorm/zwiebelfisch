// The messages between the preview and the engine worker. See worker.ts and docs/architecture/preview.typ.
import type { Box, CompileResult, Jump, PageIndex, PdfResult, Position, Pt } from '../../../core/typst-engine/typst-engine';
import type { SourceOffset, SourceRange } from '../../../core/typst-document/typst-document';
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
  | { id: number; type: 'click'; page: PageIndex; x: Pt; y: Pt }
  | { id: number; type: 'cursor'; path: string; offset: SourceOffset }
  | { id: number; type: 'boxes'; path: string; ranges: SourceRange[] }
  /** A PDF of `main`, with `sources` replacing or adding text files for this export only. */
  | { id: number; type: 'pdf'; main: string; sources: Record<string, string> };

export type Response =
  | { id: number; type: 'compile'; result: CompileResult }
  | { id: number; type: 'click'; jump: Jump | null }
  | { id: number; type: 'cursor'; positions: Position[] }
  | { id: number; type: 'boxes'; boxes: Box[] }
  | { id: number; type: 'pdf'; result: PdfResult }
  | { id: number; type: 'error'; message: string };
