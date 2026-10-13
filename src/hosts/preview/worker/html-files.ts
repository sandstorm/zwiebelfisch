// HtmlFileSender / HtmlFileReceiver: an HTML compile's files across the worker boundary, each file's data sent only
// once. See EngineWorker in worker.ts.
import type { HtmlFile } from '../../../core/typst-engine/typst-engine';

/**
 * Worker side: remembers which files the preview has (those of the last compile with files). An edit changes one
 * document of the bundle; its style sheets, images and fonts stay, and are not copied to the main thread again.
 */
export class HtmlFileSender {
  private sent = new Set<string>();

  encode(files: readonly HtmlFile[]): EncodedHtmlFile[] {
    // a failed compile has no files: the preview keeps the last good ones
    if (files.length === 0) return [];
    const encoded = files.map((file) => (this.sent.has(file.hash) ? { ...file, data: null } : file));
    this.sent = new Set(files.map((file) => file.hash));
    return encoded;
  }
}

/** A file of an HTML compile answer; `data` null: the same as the file with this hash the answer before. */
export type EncodedHtmlFile = Omit<HtmlFile, 'data'> & { data: Uint8Array | null };

/** Main-thread side: puts the data left out back from the files it has. */
export class HtmlFileReceiver {
  private known = new Map<string, Uint8Array>();

  decode(files: readonly EncodedHtmlFile[]): HtmlFile[] {
    if (files.length === 0) return [];
    const decoded = files.map((file) => ({ ...file, data: file.data ?? this.known.get(file.hash)! }));
    this.known = new Map(decoded.map((file) => [file.hash, file.data]));
    return decoded;
  }
}
