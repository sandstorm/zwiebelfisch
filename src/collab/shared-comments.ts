import * as Y from 'yjs';
import { quote, type QuoteSelector, type Range } from '../comments/anchor';
import type { Comment, Comments, CommentsData } from '../comments/comments';

/** The Y.Doc's map of review comment threads on the main file: id → thread. */
export const COMMENTS_MAP = 'comments';

/**
 * A thread's anchor in the Y.Doc: relative positions in the main file's
 * Y.Text (JSON), which stay on their characters whoever edits, plus the quote
 * as last seen, for orphans.
 */
interface SharedAnchor {
  from: unknown;
  to: unknown;
  quote: QuoteSelector;
}

/**
 * Shares the review comments of the main file through a Y.Doc: the map
 * `comments` holds one `Y.Map` per thread (`anchor`, `resolved`, and the
 * messages as a `Y.Array`, so concurrent replies merge).
 *
 * `Comments` stays the model the UI talks to. Local changes (new threads,
 * replies, resolving, removing, anchors moved by edits) are written to the
 * Y.Doc; remote ones are loaded into `Comments` with the anchors resolved
 * against the current text. Joining: the shared threads win; a room without
 * any is seeded with the local ones.
 */
export class SharedComments {
  private readonly threads: Y.Map<Y.Map<unknown>>;
  private readonly unsubscribe: () => void;
  private loading = false;

  constructor(
    private readonly comments: Comments,
    private readonly ydoc: Y.Doc,
    /** The main file's shared text (it may be replaced, e.g. when two clients seeded a room at once). */
    private readonly text: () => Y.Text | undefined,
  ) {
    this.threads = ydoc.getMap(COMMENTS_MAP);
    if (this.threads.size > 0) this.pull();
    else this.push();
    this.threads.observeDeep(this.onRemote);
    this.unsubscribe = comments.onChange(() => {
      if (!this.loading) this.push();
    });
  }

  destroy(): void {
    this.unsubscribe();
    this.threads.unobserveDeep(this.onRemote);
  }

  private readonly onRemote = (_events: unknown, transaction: Y.Transaction): void => {
    if (transaction.origin !== this) this.pull();
  };

  /** Loads the shared threads into `Comments`. */
  private pull(): void {
    const text = this.text()?.toString() ?? '';
    const data: CommentsData = { version: 1, threads: [] };
    this.threads.forEach((thread, id) => {
      const anchor = thread.get('anchor') as SharedAnchor;
      const range = this.resolve(anchor);
      data.threads.push({
        id,
        anchor: range ? quote(text, range) : anchor.quote,
        resolved: thread.get('resolved') === true,
        comments: (thread.get('comments') as Y.Array<Comment>).toArray(),
      });
    });
    this.loading = true;
    try {
      this.comments.load(JSON.stringify(data));
    } finally {
      this.loading = false;
    }
  }

  /** Writes what differs locally to the Y.Doc. */
  private push(): void {
    const selectors = new Map((JSON.parse(this.comments.serialize()) as CommentsData).threads.map((t) => [t.id, t.anchor]));
    const local = this.comments.threads();
    this.ydoc.transact(() => {
      for (const { id, range, resolved, comments } of local) {
        const thread = this.threads.get(id) ?? this.create(id);
        if (thread.get('resolved') !== resolved) thread.set('resolved', resolved);
        const messages = thread.get('comments') as Y.Array<Comment>;
        const known = new Set(messages.toArray().map((comment) => comment.id));
        const added = comments.filter((comment) => !known.has(comment.id));
        if (added.length > 0) messages.push(added);
        if (!sameRange(this.resolve(thread.get('anchor') as SharedAnchor | undefined), range)) {
          thread.set('anchor', this.anchor(range, selectors.get(id)!));
        }
      }
      const ids = new Set(local.map((thread) => thread.id));
      for (const id of [...this.threads.keys()]) if (!ids.has(id)) this.threads.delete(id);
    }, this);
  }

  private create(id: string): Y.Map<unknown> {
    const thread = new Y.Map<unknown>();
    this.threads.set(id, thread);
    thread.set('comments', new Y.Array<Comment>());
    return thread;
  }

  private anchor(range: Range | null, selector: QuoteSelector): SharedAnchor {
    const text = this.text();
    if (!range || !text) return { from: null, to: null, quote: selector };
    const position = (index: number, assoc: number) => Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, index, assoc));
    // Text typed at either edge stays outside the range: the start sticks to the character after it, the end to the one before.
    return { from: position(range.from, 0), to: position(range.to, -1), quote: selector };
  }

  /** Where `anchor` is in the current text; null for orphans (deleted text). */
  private resolve(anchor: SharedAnchor | undefined): Range | null {
    const text = this.text();
    if (!anchor?.from || !anchor.to || !text) return null;
    const offset = (json: unknown) => {
      const absolute = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(json), this.ydoc);
      return absolute?.type === text ? absolute.index : null;
    };
    const from = offset(anchor.from);
    const to = offset(anchor.to);
    return from !== null && to !== null && from < to ? { from, to } : null;
  }
}

function sameRange(a: Range | null, b: Range | null): boolean {
  return a === b || (a !== null && b !== null && a.from === b.from && a.to === b.to);
}
