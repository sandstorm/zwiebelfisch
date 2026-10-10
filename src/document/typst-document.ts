import { minimalChange } from './minimal-change';

/** A replacement of `from..to` (UTF-16 offsets) by `insert`. */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

export type ChangeListener = (changes: readonly TextChange[], origin: unknown) => void;

/**
 * The Typst source text: the single source of truth every view derives from.
 *
 * Views apply their edits with an `origin` (usually the view itself) and skip
 * notifications carrying their own origin, so edits never echo back.
 * Storage is a plain string today and becomes a shared `Y.Text` for
 * collaboration without changing this interface.
 */
export class TypstDocument {
  private current: string;
  private readonly listeners = new Set<ChangeListener>();

  constructor(text: string) {
    this.current = text;
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
    for (const listener of this.listeners) listener(effective, origin);
  }

  /**
   * Replaces the whole text, applied as the one minimal change between the
   * old and new text so cursors, undo history and reparsing stay intact.
   */
  setText(text: string, origin: unknown): void {
    const change = minimalChange(this.current, text);
    if (change) this.change([change], origin);
  }

  /** Subscribes to changes; returns the unsubscribe function. */
  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
