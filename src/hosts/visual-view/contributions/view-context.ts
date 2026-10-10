// VisualViewContext: what per-view contributions are given about the view they are made for. See contributions.ts.
import type { Node } from '@tiptap/pm/model';
import type { TypstDocument } from '../../../core/typst-document/typst-document';

/** One Visual view, as contributions made for it see it (see the `…Provider` types). */
export interface VisualViewContext {
  /** The document the view shows. */
  readonly document: TypstDocument;
  /** The source range the view's selection shows (see `VisualView.selection`). */
  selection(): { from: number; to: number };
  /**
   * The position in `doc` (the view's document node, e.g. a transaction's) that shows source offset `offset`: with
   * `bias` -1, a position at the end of the text before it (a caret at a line end stays there).
   */
  sourceToPos(doc: Node, offset: number, bias?: 1 | -1): number;
  /** The source offset a position in `doc` shows (with `bias` -1: where the text before it ends). */
  posToSource(doc: Node, pos: number, bias?: 1 | -1): number;
  /** Whether `node` shows as a box of its own (raw Typst, an image, a page break, a margin note), not as text. */
  isBox(node: Node): boolean;
}
