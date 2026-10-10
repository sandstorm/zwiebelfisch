// TypstDocument: the single source of truth of one Typst file (a string, or a shared Y.Text), and what the views
// share about it (Highlight, Presence). Entry of core/typst-document/. See ARCHITECTURE.md, "TypstDocument".
import type * as Y from 'yjs';
import { minimalChange } from './minimal-change';
import { deltaToChanges, type DeltaOp } from './y-delta';

export type { Highlight } from './highlight';
export { minimalChange } from './minimal-change';
export {
  caretElement,
  flagTextColor,
  initials,
  presenceStyle,
  type PlacedPresence,
  type Presence,
  type PresenceTarget,
  type PresenceUser,
} from './presence';

/** A replacement of `from..to` (UTF-16 offsets) by `insert`. */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export type ChangeListener = (changes: readonly TextChange[], origin: unknown) => void;

/** The origin of changes made by someone else (another collaborator, or a shared undo). */
export const REMOTE_ORIGIN = 'remote';

/**
 * The Typst source text: the single source of truth every view derives from.
 *
 * Views apply their edits with an `origin` (usually the view itself) and skip
 * notifications carrying their own origin, so edits never echo back.
 *
 * The text is a plain string, or shared through a `Y.Text` (`fromYText`,
 * `share`) for real-time collaboration. Shared or not, the interface is the
 * same: local changes go into the Y.Text, and edits arriving through it are
 * reported like any other change, with `REMOTE_ORIGIN`.
 */
export class TypstDocument {
  private current: string;
  private readonly listeners = new Set<ChangeListener>();
  private shared: Y.Text | null = null;

  constructor(text: string) {
    this.current = text;
  }

  /** A document whose text is `text`, an integrated Y.Text (part of a Y.Doc). */
  static fromYText(text: Y.Text): TypstDocument {
    const document = new TypstDocument(text.toString());
    document.share(text);
    return document;
  }

  get text(): string {
    return this.current;
  }

  /**
   * Applies `changes`, all expressed in coordinates of the text *before* this
   * call and not overlapping (like a CodeMirror ChangeSet).
   */
  change(changes: readonly TextChange[], origin: unknown): void {
    const effective = changes.filter((c) => c.from !== c.to || c.insert !== '');
    if (effective.length === 0) return;
    const descending = [...effective].sort((a, b) => b.from - a.from);
    for (const { from, to, insert } of descending) {
      this.current = this.current.slice(0, from) + insert + this.current.slice(to);
    }
    const shared = this.shared;
    // Our own transaction: `follow` skips it, the listeners hear the caller's origin below.
    shared?.doc!.transact(() => {
      for (const { from, to, insert } of descending) {
        if (to > from) shared.delete(from, to - from);
        if (insert) shared.insert(from, insert);
      }
    }, this);
    this.notify(effective, origin);
  }

  /**
   * Replaces the whole text, applied as the one minimal change between the
   * old and new text so cursors, undo history and reparsing stay intact.
   */
  setText(text: string, origin: unknown): void {
    const change = minimalChange(this.current, text);
    if (change) this.change([change], origin);
  }

  /**
   * Shares the text through `text` (an integrated Y.Text) from now on, or
   * stops sharing with null. The document adopts the Y.Text's content as one
   * minimal change with `REMOTE_ORIGIN`, so open views and anchors survive.
   * Do not call `change` inside a Y transaction of someone else.
   */
  share(text: Y.Text | null): void {
    this.shared?.unobserve(this.follow);
    this.shared = text;
    if (!text) return;
    if (!text.doc) throw new Error('TypstDocument.share: the Y.Text must belong to a Y.Doc');
    text.observe(this.follow);
    const change = minimalChange(this.current, text.toString());
    this.current = text.toString();
    if (change) this.notify([change], REMOTE_ORIGIN);
  }

  /** Subscribes to changes; returns the unsubscribe function. */
  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private readonly follow = (event: Y.YTextEvent): void => {
    if (event.transaction.origin === this) return;
    const changes = deltaToChanges(event.delta as DeltaOp[]);
    this.current = this.shared!.toString();
    if (changes.length > 0) this.notify(changes, REMOTE_ORIGIN);
  };

  private notify(changes: readonly TextChange[], origin: unknown): void {
    for (const listener of this.listeners) listener(changes, origin);
  }
}
