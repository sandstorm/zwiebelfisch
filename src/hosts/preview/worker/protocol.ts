// The messages between the preview and the engine worker. See worker.ts and docs/30_architecture/06_preview.typ.
import type { PageRect, CompileResult, SourceJump, PageIndex, PdfResult, Position, Pt } from '../../../core/typst-engine/typst-engine';
import type { SourceOffset, SourceRange } from '../../../core/typst-document/typst-document';
import type { EncodedFiles } from './project-files';
import type { FontFile } from '../../../core/engine-assets/engine-assets';

/**
 * First message to the worker: where the engine wasm and fonts are. The main thread
 * resolves the URL, so the worker file references no other asset and a
 * consumer's bundler sees the wasm next to the main module.
 */
export interface Init {
  type: 'init';
  wasm: string;
  /** Font files the engine knows the faces of; each is downloaded when a compile first uses one. */
  fonts: readonly FontFile[];
}

/** Messages between Preview (main thread) and the engine worker. */
export type EngineRequest =
  | { id: number; type: 'compile'; files: EncodedFiles; main: string }
  | { id: number; type: 'click'; page: PageIndex; x: Pt; y: Pt }
  | { id: number; type: 'cursor'; path: string; offset: SourceOffset }
  | { id: number; type: 'boxes'; path: string; ranges: SourceRange[] }
  /** A PDF of `main`, with `sources` replacing or adding text files for this export only. */
  | { id: number; type: 'pdf'; main: string; sources: Record<string, string> };

/**
 * What the worker tells unasked while it loads: not an answer to a request (no id). The preview turns these into its
 * `PreviewProgress`.
 */
export interface WorkerProgress {
  type: 'progress';
  event: LoadEvent;
}

export type LoadEvent =
  /** `loaded` bytes of the engine's wasm arrived, of `total` (null: unknown). */
  | { kind: 'engine'; loaded: number; total: number | null }
  /** The engine is ready for requests. */
  | { kind: 'ready' }
  /** The engine could not be loaded: every request fails. */
  | { kind: 'failed'; message: string }
  /** The packages (`@preview/name:version`) being downloaded now; empty: none any more. */
  | { kind: 'packages'; specs: readonly string[] }
  /** A font file is being downloaded (its name), or none any more (null). */
  | { kind: 'font'; name: string | null };

export type EngineResponse =
  | { id: number; type: 'compile'; result: CompileResult }
  | { id: number; type: 'click'; jump: SourceJump | null }
  | { id: number; type: 'cursor'; positions: Position[] }
  | { id: number; type: 'boxes'; boxes: PageRect[] }
  | { id: number; type: 'pdf'; result: PdfResult }
  | { id: number; type: 'error'; message: string };
