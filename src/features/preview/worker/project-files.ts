// FileSender / FileReceiver: the project's file map across the worker boundary, bytes sent only once. See worker.ts.
import type { FileContent } from '../../../core/project/project';
import type { Engine } from '../../../core/typst-engine/typst-engine';

/**
 * The file map of a compile request. `null` stands for the same bytes as in
 * the previous request, so images are not copied to the worker per keystroke.
 */
export type EncodedFiles = Record<string, FileContent | null>;

/** Main-thread side: remembers which bytes the worker already has. */
export class FileSender {
  private sent = new Map<string, Uint8Array>();

  encode(files: Record<string, FileContent>): EncodedFiles {
    const sent = new Map<string, Uint8Array>();
    const encoded: EncodedFiles = {};
    for (const [path, content] of Object.entries(files)) {
      if (typeof content === 'string') {
        encoded[path] = content;
        continue;
      }
      encoded[path] = this.sent.get(path) === content ? null : content;
      sent.set(path, content);
    }
    this.sent = sent;
    return encoded;
  }
}

/** Worker side: applies each request's file map to the engine. */
export class FileReceiver {
  private known = new Set<string>();

  constructor(private readonly engine: Engine) {}

  /** Adds and updates the given files and removes those not given any more. */
  apply(files: EncodedFiles): void {
    const paths = new Set(Object.keys(files));
    for (const path of this.known) if (!paths.has(path)) this.engine.remove(path);
    for (const [path, content] of Object.entries(files)) {
      if (typeof content === 'string') this.engine.setSource(path, content);
      else if (content) this.engine.setBinary(path, content);
    }
    this.known = paths;
  }
}
