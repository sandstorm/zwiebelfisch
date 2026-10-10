import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { Highlight } from '../document/highlight';

/** The highlight layer remote cursors are drawn in. */
export const CURSOR_LAYER = 'remote-cursors';

/** Who is editing here, as others see it. */
export interface CollaborationUser {
  name: string;
  /** A CSS color for their cursor and selection (default: picked from the name). */
  color?: string;
}

/** A view that draws highlights (SourceView, VisualView). */
export interface HighlightTarget {
  setHighlights(layer: string, highlights: readonly Highlight[]): void;
}

export interface RemoteCursorsOptions {
  user: CollaborationUser;
  /** The shared text of `path` (where cursors are anchored). */
  text(path: string): Y.Text | undefined;
}

/** What a client publishes in its awareness state (field `cursor`; `user` follows the y-codemirror convention). */
interface CursorState {
  path: string;
  anchor: unknown;
  head: unknown;
}

const PALETTE = ['#d33682', '#2aa198', '#6c71c4', '#cb4b16', '#268bd2', '#859900', '#b58900', '#dc322f'];

/**
 * Presence: publishes the local user's selection through y-protocols
 * awareness, and draws the other users' selections and carets as highlights
 * in the views of the file shown here. Positions travel as Y relative
 * positions, so they stay on their characters while anyone edits; they are
 * resolved again after every change of the shown text and every presence
 * update (once per microtask, after the views have taken the change).
 */
export class RemoteCursors {
  private path: string | null = null;
  private views: readonly HighlightTarget[] = [];
  private observed: Y.Text | undefined;
  private scheduled = false;
  private destroyed = false;

  constructor(
    private readonly awareness: Awareness,
    private readonly options: RemoteCursorsOptions,
  ) {
    const { name, color } = options.user;
    awareness.setLocalStateField('user', { name, color: color ?? colorFor(name) });
    awareness.on('change', this.schedule);
  }

  /** Publishes where the local user is: a source range in `path`, or nowhere (null). */
  setLocal(path: string | null, range?: { from: number; to: number }): void {
    const text = path && range ? this.options.text(path) : undefined;
    if (!path || !range || !text) {
      this.awareness.setLocalStateField('cursor', null);
      return;
    }
    const position = (index: number) => Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, index));
    const cursor: CursorState = { path, anchor: position(range.from), head: position(range.to) };
    this.awareness.setLocalStateField('cursor', cursor);
  }

  /** Draws the cursors of `path` into `views` from now on, and clears the views drawn into before. */
  show(path: string | null, views: readonly HighlightTarget[]): void {
    for (const view of this.views) if (!views.includes(view)) view.setHighlights(CURSOR_LAYER, []);
    this.path = path;
    this.views = views;
    this.render();
  }

  destroy(): void {
    this.destroyed = true;
    this.awareness.off('change', this.schedule);
    this.observed?.unobserve(this.schedule);
    this.awareness.setLocalStateField('cursor', null);
    for (const view of this.views) view.setHighlights(CURSOR_LAYER, []);
  }

  private readonly schedule = (): void => {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.destroyed) this.render();
    });
  };

  private render(): void {
    const text = this.path ? this.options.text(this.path) : undefined;
    if (text !== this.observed) {
      this.observed?.unobserve(this.schedule);
      text?.observe(this.schedule);
      this.observed = text;
    }
    const highlights = text ? this.highlights(text) : [];
    for (const view of this.views) view.setHighlights(CURSOR_LAYER, highlights);
  }

  private highlights(text: Y.Text): Highlight[] {
    const content = text.toString();
    const result: Highlight[] = [];
    this.awareness.getStates().forEach((state, client) => {
      const cursor = state.cursor as CursorState | null | undefined;
      if (client === this.awareness.clientID || cursor?.path !== this.path) return;
      const anchor = this.resolve(cursor.anchor, text);
      const head = this.resolve(cursor.head, text);
      if (anchor === null || head === null) return;
      const user = state.user as CollaborationUser | undefined;
      const attributes = { 'data-user': user?.name ?? '', style: `--typst-remote-color: ${user?.color ?? PALETTE[0]}` };
      if (anchor !== head) result.push({ from: Math.min(anchor, head), to: Math.max(anchor, head), className: 'typst-remote-selection', attributes });
      const caret = caretAt(content, head);
      if (caret) result.push({ ...caret, attributes });
    });
    return result;
  }

  private resolve(json: unknown, text: Y.Text): number | null {
    const absolute = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(json), text.doc!);
    return absolute?.type === text ? absolute.index : null;
  }
}

/**
 * The caret at `offset` as a highlight of one character (views draw marks,
 * not empty ranges): the character after it, drawn with a left border, or at
 * a line or text end the one before it, with a right border.
 */
function caretAt(text: string, offset: number): Highlight | null {
  if (offset < text.length && text[offset] !== '\n') {
    return { from: offset, to: offset + 1, className: 'typst-remote-cursor' };
  }
  if (offset > 0 && text[offset - 1] !== '\n') {
    return { from: offset - 1, to: offset, className: 'typst-remote-cursor typst-remote-cursor--end' };
  }
  return null;
}

/** A stable color for a user without one. */
function colorFor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
