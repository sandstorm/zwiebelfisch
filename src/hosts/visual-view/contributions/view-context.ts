// VisualViewContext: what per-view contributions are given about the view they are made for. See contributions.ts.
import type { Event } from '../../../core/event-emitter/event-emitter';
import type { Presence, TypstDocument } from '../../../core/typst-document/typst-document';

/** One Visual view, as contributions made for it see it (see the `…Provider` types). */
export interface VisualViewContext {
  /** The document the view shows. */
  readonly document: TypstDocument;
  /** The source range the view's selection shows (see `VisualView.selection`). */
  selection(): { from: number; to: number };
  /**
   * Fires with the other users' carets and selections whenever the view (a `PresenceTarget`) is given new ones;
   * source offsets in the document's text at that moment.
   */
  readonly onDidChangePresence: Event<readonly Presence[]>;
}
