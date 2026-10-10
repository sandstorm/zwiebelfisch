import type { TextChange, TypstDocument } from '../document/typst-document';
import { mapRange, quote, reanchor, type QuoteSelector, type Range } from './anchor';

export type { Range } from './anchor';

/** One message in a thread. `time` is an ISO 8601 timestamp. */
export interface Comment {
  id: string;
  author: string;
  time: string;
  text: string;
}

/**
 * A comment thread on a stretch of the source. `range` is where it is now, or
 * null for an orphan whose text was deleted or could not be found again;
 * `quote` is the commented text (as last seen, for orphans).
 */
export interface Thread {
  id: string;
  range: Range | null;
  quote: string;
  resolved: boolean;
  comments: readonly Comment[];
}

/** The persisted form (`serialize()` / `load()`), stored beside the Typst file, never in it. */
export interface CommentsData {
  version: 1;
  threads: { id: string; anchor: QuoteSelector; resolved: boolean; comments: Comment[] }[];
}

export interface CommentsOptions {
  /** Threads to start with, as produced by `serialize()`. */
  json?: string;
  /** Author of the comments written here. */
  user?: { name: string };
  /** Clock and id source; for tests. */
  now?: () => Date;
  id?: () => string;
}

interface State {
  id: string;
  range: Range | null;
  /** The anchor as last seen; what an orphan is persisted and found again by. */
  selector: QuoteSelector;
  resolved: boolean;
  comments: Comment[];
}

/**
 * Review comments on a TypstDocument, kept beside the source (never in it).
 *
 * Anchors follow every change of the document, whichever view or API made
 * it. Threads whose text gets deleted become orphans and come back when the
 * exact text with its context reappears (undo). Persisted anchors are quote
 * selectors, so `load()` finds the text again even after the file was
 * changed elsewhere.
 */
export class Comments {
  private states: State[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribe: () => void;
  private readonly author: string;
  private readonly now: () => Date;
  private readonly newId: () => string;
  /** The document text the ranges refer to (the text before a change, while handling it). */
  private text: string;

  constructor(
    private readonly document: TypstDocument,
    options: CommentsOptions = {},
  ) {
    this.author = options.user?.name ?? 'Anonymous';
    this.now = options.now ?? (() => new Date());
    this.newId = options.id ?? randomId;
    this.text = document.text;
    if (options.json) this.states = parse(options.json, this.text);
    this.unsubscribe = document.onChange((changes) => this.follow(changes));
  }

  /** All threads: orphans first, then in document order. */
  threads(): Thread[] {
    const position = (state: State) => state.range?.from ?? -1;
    return [...this.states]
      .sort((a, b) => position(a) - position(b))
      .map(({ id, range, selector, resolved, comments }) => ({
        id,
        range: range && { ...range },
        quote: range ? this.text.slice(range.from, range.to) : selector.exact,
        resolved,
        comments: [...comments],
      }));
  }

  /** Starts a thread on `range` with a first comment; returns its id. Ignores empty ranges. */
  add(range: Range, text: string): string | null {
    if (range.from >= range.to) return null;
    const id = this.newId();
    this.states.push({ id, range: { ...range }, selector: quote(this.text, range), resolved: false, comments: [this.comment(text)] });
    this.notify();
    return id;
  }

  reply(threadId: string, text: string): void {
    this.update(threadId, (state) => state.comments.push(this.comment(text)));
  }

  setResolved(threadId: string, resolved: boolean): void {
    this.update(threadId, (state) => (state.resolved = resolved));
  }

  remove(threadId: string): void {
    const before = this.states.length;
    this.states = this.states.filter((state) => state.id !== threadId);
    if (this.states.length !== before) this.notify();
  }

  /** Replaces all threads with persisted ones, finding their text in the current document. */
  load(json: string): void {
    this.states = parse(json, this.text);
    this.notify();
  }

  /** The threads as JSON (`CommentsData`). */
  serialize(): string {
    const data: CommentsData = {
      version: 1,
      threads: this.states.map(({ id, range, selector, resolved, comments }) => ({
        id,
        anchor: range ? quote(this.text, range) : selector,
        resolved,
        comments,
      })),
    };
    return JSON.stringify(data);
  }

  /** Called after every change: threads, replies, resolution, or anchors moved by an edit. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.unsubscribe();
    this.listeners.clear();
  }

  private follow(changes: readonly TextChange[]): void {
    const text = this.document.text;
    for (const state of this.states) {
      if (state.range) this.move(state, changes);
      else state.range = findVerbatim(text, state.selector);
    }
    this.text = text;
    if (this.states.length > 0) this.notify();
  }

  /** Maps an anchored thread through `changes`; it becomes an orphan if its text is gone. */
  private move(state: State, changes: readonly TextChange[]): void {
    const range = mapRange(state.range!, changes);
    if (range.from < range.to) {
      state.range = range;
    } else {
      state.selector = quote(this.text, state.range!);
      state.range = null;
    }
  }

  private update(threadId: string, apply: (state: State) => void): void {
    const state = this.states.find((candidate) => candidate.id === threadId);
    if (!state) return;
    apply(state);
    this.notify();
  }

  private comment(text: string): Comment {
    return { id: this.newId(), author: this.author, time: this.now().toISOString(), text };
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

function parse(json: string, text: string): State[] {
  const data = JSON.parse(json) as Partial<CommentsData>;
  return (data.threads ?? []).map(({ id, anchor, resolved, comments }) => ({
    id,
    range: reanchor(text, anchor),
    selector: anchor,
    resolved: Boolean(resolved),
    comments: [...(comments ?? [])],
  }));
}

/** Where the quote reappears exactly, with its full context (e.g. after undoing a deletion). */
function findVerbatim(text: string, { exact, prefix, suffix }: QuoteSelector): Range | null {
  const at = text.indexOf(prefix + exact + suffix);
  if (exact === '' || at < 0) return null;
  const from = at + prefix.length;
  return { from, to: from + exact.length };
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
