// FileSender / FileReceiver: the project's file map across the worker boundary, bytes sent only once. See
// EngineWorker in worker.ts.
import type { FileContent } from '../../../core/project/project';
import type { TypstEngine } from '../../../core/typst-engine/typst-engine';

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

/**
 * The file map of a compile request. `null` stands for the same bytes as in
 * the previous request, so images are not copied to the worker per keystroke.
 */
export type EncodedFiles = Record<string, FileContent | null>;

/**
 * Worker side: keeps the engine's files in step with the requests. Tasks run
 * one at a time, each with the files it was given: a compile waiting for a
 * package download never sees an export's sources, nor the reverse.
 */
export class FileReceiver {
  private known = new Set<string>();
  /** The text files of the last `update`, to restore after `withSources`. */
  private texts = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly engine: TypstEngine) {}

  /** Adds and updates the given files, removes those not given any more, then runs `task`. */
  update<T>(files: EncodedFiles, task: () => Promise<T>): Promise<T> {
    return this.exclusive(() => {
      this.apply(files);
      return task();
    });
  }

  /**
   * Runs `task` with `sources` replacing or adding text files, then restores
   * the files of the last `update` (hit-testing reads them in between).
   */
  withSources<T>(sources: Record<string, string>, task: () => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      for (const [path, text] of Object.entries(sources)) this.engine.setSource(path, text);
      try {
        return await task();
      } finally {
        for (const path of Object.keys(sources)) {
          const text = this.texts.get(path);
          if (text !== undefined) this.engine.setSource(path, text);
          else if (!this.known.has(path)) this.engine.remove(path);
        }
      }
    });
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => {});
    return run;
  }

  private apply(files: EncodedFiles): void {
    const paths = new Set(Object.keys(files));
    for (const path of this.known) if (!paths.has(path)) this.engine.remove(path);
    this.texts.clear();
    for (const [path, content] of Object.entries(files)) {
      if (typeof content === 'string') {
        this.engine.setSource(path, content);
        this.texts.set(path, content);
      } else if (content) this.engine.setBinary(path, content);
    }
    this.known = paths;
  }
}
