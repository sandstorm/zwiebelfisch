// PageSender / PageReceiver: the compiled pages across the worker boundary, each page's SVG sent only once. See
// EngineWorker in worker.ts.
import type { Page } from '../../../core/typst-engine/typst-engine';

/**
 * Worker side: remembers which pages the preview has (those of the last compile with pages). A compile answers with
 * every page, but an edit changes one or two: the SVG of a page the preview has (same hash) is left out, so a long
 * document does not cross to the main thread per keystroke.
 */
export class PageSender {
  private sent = new Set<string>();

  encode(pages: readonly Page[]): EncodedPage[] {
    // a failed compile has no pages: the preview keeps the last good ones
    if (pages.length === 0) return [];
    const encoded = pages.map((page) => (this.sent.has(page.hash) ? { ...page, svg: null } : page));
    this.sent = new Set(pages.map((page) => page.hash));
    return encoded;
  }
}

/** A page of a compile answer; `svg` null: the same as the page with this hash the answer before. */
export type EncodedPage = Omit<Page, 'svg'> & { svg: string | null };

/** Main-thread side: puts the SVGs left out back from the pages it has. */
export class PageReceiver {
  private known = new Map<string, string>();

  decode(pages: readonly EncodedPage[]): Page[] {
    if (pages.length === 0) return [];
    const decoded = pages.map((page) => ({ ...page, svg: page.svg ?? this.known.get(page.hash)! }));
    this.known = new Map(decoded.map((page) => [page.hash, page.svg]));
    return decoded;
  }
}
