// HashedSender / HashedReceiver: hash-keyed items (pages, HTML files) across the worker boundary, each payload sent
// only once. See EngineWorker in worker.ts.
import type { Hashed } from './protocol';

/**
 * Worker side: remembers which items the preview has (those of the last answer with items). A compile answers with
 * every page and HTML file, but an edit changes one or two: the payload (`field`) of an item whose hash the preview
 * has is left out (null), so a long document does not cross to the main thread per keystroke.
 */
export class HashedSender<T extends { hash: string }, K extends keyof T> {
  private sent = new Set<string>();

  /** `field`: the payload left out, `svg` of a page, `data` of an HTML file. */
  constructor(private readonly field: K) {}

  encode(items: readonly T[]): Hashed<T, K>[] {
    // a failed compile has no items: the preview keeps the last good ones
    if (items.length === 0) return [];
    const encoded = items.map((item) => (this.sent.has(item.hash) ? { ...item, [this.field]: null } : item) as Hashed<T, K>);
    this.sent = new Set(items.map((item) => item.hash));
    return encoded;
  }
}

/** Main-thread side: puts the payloads left out back from the items it has. */
export class HashedReceiver<T extends { hash: string }, K extends keyof T> {
  private known = new Map<string, T[K]>();

  /** `field`: the payload the sender leaves out. */
  constructor(private readonly field: K) {}

  decode(items: readonly Hashed<T, K>[]): T[] {
    if (items.length === 0) return [];
    const decoded = (items as readonly T[]).map((item): T => ({ ...item, [this.field]: item[this.field] ?? this.known.get(item.hash) }));
    this.known = new Map(decoded.map((item) => [item.hash, item[this.field]]));
    return decoded;
  }
}
