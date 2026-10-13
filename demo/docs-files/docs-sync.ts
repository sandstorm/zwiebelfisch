// DocsSync: the demo page's half of writing the docs in the demo. See docsFiles in plugin.ts.
import { type FileChange, FileContent, type ProjectFiles } from '../../src';
import {
  contentTag,
  DOCS_FILES_CHANGE,
  DOCS_FILES_ENDPOINT,
  DOCS_FILES_HEADER,
  DOCS_FILES_META,
  DOCS_FILES_SNAPSHOT,
  DOCS_FILES_TOKEN_PARAM,
  type DiskChange,
} from './protocol';

/**
 * Keeps docs/ and the editor's files the same. Edits are written per file once the typing pauses (`flush` writes
 * what waits, e.g. when the page is hidden); a create, rename or delete in the file panel happens on disk first and
 * is refused in the editor if the disk refuses it. A change on disk replaces the file in the editor unless the
 * editor has unsaved edits of it: then the editor's text stays, and the report says so.
 *
 * It remembers what is on disk (as far as it knows: the files it started from, wrote, or heard of), which is how it
 * tells unsaved edits apart, and why its own writes coming back cause nothing. Each write names that version as the
 * one it replaces, so the server refuses a write that would undo a change on disk the page has not heard of yet (one
 * decided, or under way, before the change arrived). After a change it has heard of, the next edit of that file
 * saves over it: the report said so.
 */
export class DocsSync {
  readonly #disk = new Map<string, FileContent>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** The extensions of the files the example has: a file of another kind made on disk stays out of the editor. */
  readonly #extensions: Set<string>;
  #queue: Promise<unknown> = Promise.resolve();
  #editor: SyncedEditor | null = null;

  /** `files`: the example's files as the page loaded them, i.e. what is on disk now. */
  constructor(
    private readonly api: DocsFilesApi,
    files: ProjectFiles,
    private readonly report: SaveReport,
  ) {
    for (const [path, content] of Object.entries(files)) this.#disk.set(path, content);
    this.#extensions = new Set(Object.keys(files).map(extension));
  }

  /** The editor to read and update. */
  attach(editor: SyncedEditor): void {
    this.#editor = editor;
  }

  /** The editor's `allowFileChange`: a create, rename or delete is done on disk first; false if that failed. */
  async allowFileChange(change: FileChange): Promise<boolean> {
    if (change.kind === 'update') return true;
    try {
      await this.#structural(change);
      return true;
    } catch {
      return false;
    }
  }

  /** The editor's `onFilesChange`: what differs from the disk is written, after a pause for an edit. */
  filesChanged(change: FileChange): void {
    if (change.kind === 'update' || change.kind === 'create') {
      if (!same(change.content, this.#disk.get(change.path))) this.#schedule(change.path);
    } else {
      // done on disk already when it came through allowFileChange (the disk no longer has the old path)
      void this.#structural(change).catch(() => undefined);
      if (change.kind === 'rename' && !same(this.#content(change.path), this.#disk.get(change.path))) this.#schedule(change.path);
    }
  }

  /** A file changed on disk (the plugin's event): into the editor, unless it has unsaved edits of it. */
  external(change: DiskChange): void {
    const path = `/${change.path}`;
    const incoming = diskContent(change);
    const current = this.#content(path);
    if (same(current, incoming)) return this.#setDisk(path, incoming);
    // known already: the page's own write coming back
    if (same(this.#disk.get(path), incoming)) return;
    if (current === undefined && !this.#extensions.has(extension(path))) return;
    const unsaved = current !== undefined && !same(current, this.#disk.get(path));
    this.#setDisk(path, incoming);
    if (unsaved) {
      this.#cancel(path);
      return this.report(`docs${path} changed on disk while it had unsaved edits here: kept the editor’s text (your next edit saves it over the disk’s)`, 'warn');
    }
    const files = { ...this.#editor!.files };
    if (incoming === null) delete files[path];
    else files[path] = incoming;
    this.#editor!.files = files;
    this.report(`Updated docs${path} from disk`, 'muted');
  }

  /**
   * What is on disk now (the plugin's snapshot, on each connection): every file that differs comes in as a change on
   * disk, and a file it knew on disk that is no longer there as deleted. A built page starts from the files of its
   * build, which may be older.
   */
  snapshot(files: DiskChange[]): void {
    const present = new Set(files.map((change) => `/${change.path}`));
    for (const change of files) this.external(change);
    for (const path of [...this.#disk.keys()]) if (!present.has(path)) this.external({ path: relative(path), deleted: true });
  }

  /** Writes every file waiting for its pause now, without waiting for earlier writes (the page may be going away). */
  flush(): void {
    for (const path of [...this.#timers.keys()]) {
      this.#cancel(path);
      const save = this.#unsaved(path);
      if (save) void save().catch(() => undefined);
    }
  }

  async #structural(change: FileChange): Promise<void> {
    switch (change.kind) {
      case 'create': {
        const base = this.#disk.get(change.path);
        return this.#run(change.path, 'Saved to', () => this.#write(change.path, change.content, base));
      }
      case 'delete':
        this.#cancel(change.path);
        if (!this.#disk.has(change.path)) return;
        return this.#run(change.path, 'Deleted', async () => {
          await this.api.delete(relative(change.path));
          this.#disk.delete(change.path);
        });
      case 'rename':
        this.#cancel(change.from);
        if (!this.#disk.has(change.from)) return;
        return this.#run(change.path, 'Renamed to', async () => {
          await this.api.rename(relative(change.from), relative(change.path));
          this.#disk.set(change.path, this.#disk.get(change.from)!);
          this.#disk.delete(change.from);
        });
    }
  }

  #schedule(path: string): void {
    this.#cancel(path);
    this.#timers.set(
      path,
      setTimeout(() => {
        this.#timers.delete(path);
        const save = this.#unsaved(path);
        if (save) void this.#run(path, 'Saved to', save).catch(() => undefined);
      }, SAVE_DELAY),
    );
  }

  /** The write of the editor's text of `path` over the version on disk as known now; null when they are the same. */
  #unsaved(path: string): (() => Promise<void>) | null {
    const content = this.#content(path);
    const base = this.#disk.get(path);
    return content === undefined || same(content, base) ? null : () => this.#write(path, content, base);
  }

  /** Writes `content` over the version `base` (undefined: no file); the server refuses it if the disk has another. */
  async #write(path: string, content: FileContent, base: FileContent | undefined): Promise<void> {
    await this.api.write(relative(path), FileContent.bytes(content), base === undefined ? null : FileContent.bytes(base));
    // a change on disk heard meanwhile came after this write (the disk still had `base` when it took it)
    if (this.#disk.get(path) === base) this.#disk.set(path, content);
  }

  /**
   * Runs `operation` on `path` after the ones before it (a rename and the write that follows stay in order), and
   * reports it: "Saving…", then `done` with the path, or why it failed.
   */
  #run(path: string, done: string, operation: () => Promise<void>): Promise<void> {
    this.report('Saving…', 'muted');
    const result = this.#queue.then(operation);
    this.#queue = result.catch(() => undefined);
    return result.then(
      () => this.report(`${done} docs${path}`, 'ok'),
      (error: unknown) => {
        this.report(`Not saved: docs${path} (${(error as Error).message})`, 'warn');
        throw error;
      },
    );
  }

  #cancel(path: string): void {
    clearTimeout(this.#timers.get(path));
    this.#timers.delete(path);
  }

  #content(path: string): FileContent | undefined {
    return this.#editor?.files[path];
  }

  #setDisk(path: string, content: FileContent | null): void {
    if (content === null) this.#disk.delete(path);
    else this.#disk.set(path, content);
  }
}

/** The plugin's file API, by paths relative to docs/ (`20_features/03_writing.typ`). */
export interface DocsFilesApi {
  /** Writes `bytes` over `base`, the version the page last read or wrote (null: no file); rejects if the disk has another. */
  write(path: string, bytes: Uint8Array, base: Uint8Array | null): Promise<void>;
  delete(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export type SaveLevel = 'muted' | 'ok' | 'warn';

/** Where the sync tells what it did: a line for the playground bar. */
export type SaveReport = (text: string, level: SaveLevel) => void;

/** The editor as far as the sync needs it: its files, to read and to replace (the widget's `files`). */
export interface SyncedEditor {
  files: ProjectFiles;
}

/**
 * The sync for the page the plugin served, wired to the plugin (its token in the page, its event stream) and to the
 * page going away; null in a static build, which has no plugin.
 */
export function connectDocsSync(files: ProjectFiles, report: SaveReport): DocsSync | null {
  const token = docsFilesToken(document);
  if (!token) return null;
  const sync = new DocsSync(httpDocsFilesApi(token), files, report);
  const events = new EventSource(`${DOCS_FILES_ENDPOINT}?${new URLSearchParams({ [DOCS_FILES_TOKEN_PARAM]: token })}`);
  events.addEventListener(DOCS_FILES_SNAPSHOT, (event) => sync.snapshot(JSON.parse(event.data) as DiskChange[]));
  events.addEventListener(DOCS_FILES_CHANGE, (event) => sync.external(JSON.parse(event.data) as DiskChange));
  addEventListener('pagehide', () => sync.flush());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && sync.flush());
  return sync;
}

/** The plugin's session token, if `document` came from a server with the plugin (a static build has none). */
export function docsFilesToken(document: Document): string | null {
  return document.querySelector<HTMLMetaElement>(`meta[name="${DOCS_FILES_META}"]`)?.content || null;
}

/** The plugin's file API over HTTP, with its session `token`. */
export function httpDocsFilesApi(token: string, send: typeof fetch = fetch): DocsFilesApi {
  const call = async (method: string, query: Record<string, string>, body?: Uint8Array, precondition?: Record<string, string>) => {
    const response = await send(`${DOCS_FILES_ENDPOINT}?${new URLSearchParams(query)}`, {
      method,
      headers: { [DOCS_FILES_HEADER]: token, 'content-type': 'application/octet-stream', ...precondition },
      body: body as BodyInit | undefined,
      // a write when the page goes away still arrives (keepalive bodies are limited to 64 KiB)
      keepalive: (body?.length ?? 0) < 60_000,
    });
    if (!response.ok) throw new Error((await response.text()) || `${response.status}`);
  };
  return {
    write: (path, bytes, base) => call('PUT', { path }, bytes, base === null ? { 'if-none-match': '*' } : { 'if-match': `"${contentTag(base)}"` }),
    delete: (path) => call('DELETE', { path }),
    rename: (from, to) => call('POST', { path: from, to }),
  };
}

function extension(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1).toLowerCase();
}

function same(a: FileContent | null | undefined, b: FileContent | null | undefined): boolean {
  if (a == null || b == null) return (a ?? null) === (b ?? null);
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  const [x, y] = [FileContent.bytes(a), FileContent.bytes(b)];
  return x.length === y.length && x.every((byte, at) => byte === y[at]);
}

/** The content of a project file from disk: a Typst file's text, any other file's bytes; null when deleted. */
function diskContent(change: DiskChange): FileContent | null {
  if ('deleted' in change) return null;
  if ('base64' in change) return Uint8Array.from(atob(change.base64), (char) => char.charCodeAt(0));
  return change.path.endsWith('.typ') ? change.text : new TextEncoder().encode(change.text);
}

/** `/20_features/03_writing.typ` → `20_features/03_writing.typ`. */
function relative(path: string): string {
  return path.slice(1);
}

/** How long an edited file waits for more edits before it is written. */
const SAVE_DELAY = 300;
