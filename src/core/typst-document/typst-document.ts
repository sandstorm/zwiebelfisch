// TypstDocument: the single source of truth of one Typst file's text. Entry of core/typst-document/. See
// ARCHITECTURE.md, "TypstDocument".
// Why no collaboration here: sharing the text (Yjs) is the collaboration extension's. It binds a Y.Text to a
// document from outside, like y-codemirror binds one to an editor: local changes go into the Y.Text, and edits
// arriving through it come back through `change`, with an origin of its own.
import { EventEmitter, type Event } from '../event-emitter/event-emitter';
import { minimalChange } from './minimal-change';
import type { TextChange } from './text-change';

export { calculateImportChange, type ImportRequest } from './calculate-import-change';
export type { Highlight } from './highlight';
export type { TextChange } from './text-change';
export { minimalChange } from './minimal-change';

/** What `TypstDocument.onDidChange` tells: the changes (coordinates of the text before them) and who made them. */
export interface TypstDocumentChangeEvent {
  readonly contentChanges: readonly TextChange[];
  readonly origin: unknown;
}

/**
 * The Typst source text: the single source of truth every view derives from.
 *
 * Views apply their edits with an `origin` (usually the view itself) and skip
 * notifications carrying their own origin, so edits never echo back.
 *
 * Every listener hears every change in the order the changes were made, also
 * when a listener changes the document while it is told about a change (that
 * change is told once everyone has heard the first one).
 */
export class TypstDocument {
  private current: string;
  private readonly changed = new EventEmitter<TypstDocumentChangeEvent>();
  /** Fires after every change, with its origin. */
  readonly onDidChange: Event<TypstDocumentChangeEvent> = this.changed.event;
  /** Changes made while listeners were being told about an earlier one, to tell next. */
  private readonly queued: TypstDocumentChangeEvent[] = [];
  private telling = false;

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
    for (const { from, to, insert } of [...effective].sort((a, b) => b.from - a.from)) {
      this.current = this.current.slice(0, from) + insert + this.current.slice(to);
    }
    this.tell({ contentChanges: effective, origin });
  }

  /**
   * Replaces the whole text, applied as the one minimal change between the
   * old and new text so cursors, undo history and reparsing stay intact.
   */
  setText(text: string, origin: unknown): void {
    const change = minimalChange(this.current, text);
    if (change) this.change([change], origin);
  }

  /** Tells the listeners about `event`, after the changes before it (VS Code's delivery queue). */
  private tell(event: TypstDocumentChangeEvent): void {
    this.queued.push(event);
    if (this.telling) return;
    this.telling = true;
    try {
      for (let next = this.queued.shift(); next; next = this.queued.shift()) this.changed.fire(next);
    } finally {
      this.telling = false;
      this.queued.length = 0;
    }
  }
}
