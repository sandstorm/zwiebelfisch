// VisualViewContext: what per-view contributions are given about the view they are made for. See contributions.ts.
import type { TypstDocument } from '../../../core/typst-document/typst-document';

/** One Visual view, as contributions made for it see it (see the `…Provider` types). */
export interface VisualViewContext {
  /** The document the view shows. */
  readonly document: TypstDocument;
  /** The source range the view's selection shows (see `VisualView.selection`). */
  selection(): { from: number; to: number };
}
