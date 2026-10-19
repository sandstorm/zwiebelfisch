// The messages between the preview and the engine worker. See EngineWorker in worker.ts.
import type { PageRect, CompileResult, ElementLocation, HtmlFile, HtmlResult, Page, SourceJump, PageIndex, PdfResult, Position, Pt } from '../../../core/typst-engine/typst-engine';
import type { SourceOffset, SourceRange } from '../../../core/typst-document/typst-document';
import type { FileContent } from '../../../core/project/project';
import type { FontFile } from './engine-assets';
import type { LoadEvent } from '../preview';

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
  /** `main` compiled to HTML (the preview's HTML renderers), with the files as `compile`'s. */
  | { id: number; type: 'html'; files: EncodedFiles; main: string }
  /** The elements of the last HTML compile the cursor produced. */
  | { id: number; type: 'elements'; path: string; offset: SourceOffset }
  | { id: number; type: 'click'; page: PageIndex; x: Pt; y: Pt }
  | { id: number; type: 'cursor'; path: string; offset: SourceOffset }
  | { id: number; type: 'boxes'; path: string; ranges: SourceRange[] }
  /** A PDF of `main`, with `sources` replacing or adding text files for this export only. */
  | { id: number; type: 'pdf'; main: string; sources: Record<string, string> };

/** What the worker tells unasked while it loads: not an answer to a request (no id). The preview passes it on as is. */
export interface WorkerProgress {
  type: 'progress';
  event: WorkerLoadEvent;
}

/** The load events the worker tells; the preview itself tells `starting`. */
export type WorkerLoadEvent = Exclude<LoadEvent, { kind: 'starting' }>;

export type EngineResponse =
  /** `memoryInUse`: the engine's `TypstEngine.memoryInUse` after the compile. */
  | { id: number; type: 'compile'; result: Omit<CompileResult, 'pages'> & { pages: Hashed<Page, 'svg'>[] }; memoryInUse: number }
  | { id: number; type: 'html'; result: Omit<HtmlResult, 'files'> & { files: Hashed<HtmlFile, 'data'>[] }; memoryInUse: number }
  | { id: number; type: 'elements'; elements: ElementLocation[] }
  | { id: number; type: 'click'; jump: SourceJump | null }
  | { id: number; type: 'cursor'; positions: Position[] }
  | { id: number; type: 'boxes'; boxes: PageRect[] }
  | { id: number; type: 'pdf'; result: PdfResult }
  /** The request failed; `crashed`: the engine crashed (`TypstEngineCrash`), and this worker answers no request any more. */
  | { id: number; type: 'error'; message: string; crashed: boolean };

/**
 * The file map of a compile request. `null` stands for the same bytes as in
 * the previous request, so images are not copied to the worker per keystroke.
 */
export type EncodedFiles = Record<string, FileContent | null>;

/** An item of an answer (a page, an HTML file); its `K` null: the same as the item with this hash the answer before. */
export type Hashed<T, K extends keyof T> = Omit<T, K> & { [P in K]: T[P] | null };
