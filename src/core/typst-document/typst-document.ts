import type { Tree } from '@lezer/common';
import { typstParser } from 'codemirror-lang-typst/lezer';
import { EventEmitter, type Event } from '../event-emitter/event-emitter';

/**
 * The text of one `.typ` file: the single source of truth every editor derives from. Read and edited by:
 * - the Visual and Source editors
 * - the preview and the indexes
 * - the collaboration extension, which binds a Y.Text to it
 *
 * Each editor applies its edits with an `origin` and skips events with its own, so edits never echo back. Every
 * listener hears every change in the order the changes were made, also when a listener changes the document while it
 * is told (that change is told once everyone has heard the first one).
 */
export class TypstDocument {
  private current: string;
  private readonly changed = new EventEmitter<TypstDocumentChangeEvent>();
  /** Fires after every change, with its origin. */
  readonly onDidChange: Event<TypstDocumentChangeEvent> = this.changed.event;
  /** Changes made while listeners were being told about an earlier one, to tell next. */
  private readonly queued: TypstDocumentChangeEvent[] = [];
  private telling = false;
  /** The syntax tree of `current`; null until asked for after a change. */
  private tree: Tree | null = null;

  constructor(text: string) {
    this.current = text;
  }

  get text(): string {
    return this.current;
  }

  /** The Lezer syntax tree of the current text: parsed when first asked for after a change, the same tree until the next. */
  get syntaxTree(): Tree {
    this.tree ??= typstParser.parse(this.current);
    return this.tree;
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
    this.tree = null;
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

/**
 * An offset into a Typst document's text, in UTF-16 code units (as Lezer, CodeMirror and string indices count). Not a
 * position in the Visual editor's ProseMirror document: the Typst ↔ ProseMirror conversion's `sourceToPos` / `posToSource` convert.
 */
export type SourceOffset = number & { readonly __type: 'SourceOffset' };

export const SourceOffset = {
  /** `value`, counted in the text itself (a string index, a Lezer node's or a CodeMirror position), as an offset. */
  of(value: number): SourceOffset {
    return value as SourceOffset;
  },
};

/** A stretch `from..to` of a Typst document's text. */
export interface SourceRange {
  readonly from: SourceOffset;
  readonly to: SourceOffset;
}

export const SourceRange = {
  /** `range` (a Lezer node, a CodeMirror selection, two string indices) as a source range. */
  of(range: { readonly from: number; readonly to: number }): SourceRange {
    return { from: range.from as SourceOffset, to: range.to as SourceOffset };
  },
};

/** A replacement of `from..to` by `insert`: the one edit format of the widget (CodeMirror's ChangeSpec shape). */
export interface TextChange extends SourceRange {
  readonly insert: string;
}

/** What `TypstDocument.onDidChange` tells: the changes (coordinates of the text before them) and who made them. */
export interface TypstDocumentChangeEvent {
  readonly contentChanges: readonly TextChange[];
  readonly origin: unknown;
}

/**
 * The single change that turns `before` into `after`, covering only the part
 * between their common prefix and suffix (null if they are equal). Keeps
 * cursors, undo history and incremental reparsing intact when a whole new
 * text is set from outside. Never splits a UTF-16 surrogate pair.
 */
export function minimalChange(before: string, after: string): TextChange | null {
  if (before === after) return null;
  const max = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < max && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
  if (prefix > 0 && isHighSurrogate(before.charCodeAt(prefix - 1))) prefix--;

  let suffix = 0;
  const maxSuffix = max - prefix;
  while (suffix < maxSuffix && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) suffix++;
  if (suffix > 0 && isLowSurrogate(before.charCodeAt(before.length - suffix))) suffix--;

  return { ...SourceRange.of({ from: prefix, to: before.length - suffix }), insert: after.slice(prefix, after.length - suffix) };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
