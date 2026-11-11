// The folder `zwiebelfisch [path]` serves (server/lib/local), as the editor's project: loaded once, every change
// written back to its files, and the changes other programs make on disk shown.

import type { Extension, FileChange, FileContent, ProjectFiles } from '../../src';
import { ProjectPath } from '../../src';

/** The folder as the editor starts with it. */
export interface LocalProject {
  readonly name: string;
  readonly main: ProjectPath;
  readonly files: ProjectFiles;
}

/** How long a Typst file's edits wait before they are written: the last of them is. */
const WRITE_DELAY_MS = 300;

/** One change as the server streams it: a file's content as base64. */
interface DiskChange {
  readonly kind: 'create' | 'update' | 'delete' | 'rename';
  readonly path: string;
  readonly from?: string;
  readonly content?: string;
  /** The client that made it; absent: another program, on disk. */
  readonly by?: string;
}

/**
 * The local server's folder, for one page.
 * - `load`: the files to create the editor with
 * - `extension`: writes the project's changes (Writes) and applies the disk's, except to a file with edits not
 *   written yet: those win
 */
export class LocalFolder {
  private readonly client = crypto.randomUUID();

  constructor(private readonly token: string) {}

  async load(): Promise<LocalProject> {
    const response = await this.fetch('/api/local/project');
    const project = (await response.json()) as { name: string; main: string; files: Record<string, string> };
    const files: ProjectFiles = {};
    for (const [path, content] of Object.entries(project.files)) files[path] = decode(path, content);
    return { name: project.name, main: ProjectPath.of(project.main), files };
  }

  extension(): Extension {
    return {
      id: 'app.localFolder',
      activate: ({ project, window, subscriptions }) => {
        const writes = new Writes(this.fetch.bind(this), (problem) => void window.showErrorMessage(problem));
        let fromDisk = false;
        const apply = (change: DiskChange) => {
          const path = ProjectPath.parse(change.path);
          if (!path || change.by === this.client) return;
          if (writes.pending(path)) {
            void window.showWarningMessage(`${ProjectPath.displayName(path)} changed on disk; your edits replace that change.`);
            return;
          }
          const next = diskChange(change, path, project.has(path), project.main);
          if (!next || (next.kind === 'update' && same(project.content(path), next.content)) || project.check(next)) return;
          fromDisk = true;
          try {
            project.apply(next);
          } finally {
            fromDisk = false;
          }
        };
        const view = window.ownerDocument.defaultView;
        const warnBeforeLeaving = (event: BeforeUnloadEvent) => writes.pending() && event.preventDefault();
        view?.addEventListener('beforeunload', warnBeforeLeaving);
        const changes = new AbortController();
        subscriptions.push(
          project.onDidChangeFile((change) => fromDisk || writes.save(change)),
          { dispose: () => view?.removeEventListener('beforeunload', warnBeforeLeaving) },
          { dispose: () => changes.abort() },
        );
        this.follow(apply, changes.signal).then(
          () => void window.showErrorMessage('Zwiebelfisch stopped in the terminal: changes are no longer saved. Start it again and reload this page.'),
          () => undefined, // disposed
        );
      },
    };
  }

  /** Calls `apply` with each change from the server until it stops streaming them (resolves) or `signal` aborts. */
  private async follow(apply: (change: DiskChange) => void, signal: AbortSignal): Promise<void> {
    try {
      const response = await this.fetch('/api/local/events', { signal });
      for await (const line of lines(response.body!)) apply(JSON.parse(line) as DiskChange);
    } catch (error) {
      if (signal.aborted) throw error;
    }
  }

  private async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, 'X-Zwiebelfisch-Client': this.client },
    });
    if (!response.ok) throw new Error((await response.text()).trim() || `HTTP ${response.status}`);
    return response;
  }
}

/**
 * The project's changes written to the folder, in order: a Typst file's edits a moment after the last one (the last
 * text is), everything else at once. A failure is told with the file's name.
 */
export class Writes {
  private readonly unwritten = new Map<ProjectPath, { content: FileContent; timer: ReturnType<typeof setTimeout> }>();
  private queue = Promise.resolve();

  constructor(
    private readonly fetch: (url: string, init: RequestInit) => Promise<Response>,
    private readonly fail: (problem: string) => void,
  ) {}

  /** Whether `path` (without: any file) has edits not written yet. */
  pending(path?: ProjectPath): boolean {
    return path ? this.unwritten.has(path) : this.unwritten.size > 0;
  }

  save(change: FileChange): void {
    switch (change.kind) {
      case 'update':
        this.drop(change.path);
        this.unwritten.set(change.path, { content: change.content, timer: setTimeout(() => this.flush(change.path), WRITE_DELAY_MS) });
        return;
      case 'create':
        this.drop(change.path);
        return this.put(change.path, change.content);
      case 'delete':
        this.drop(change.path);
        return this.send(change.path, filesUrl(change.path), { method: 'DELETE' });
      case 'rename':
        this.flush(change.from);
        return this.send(change.from, '/api/local/rename', { method: 'POST', body: JSON.stringify({ from: change.from, to: change.path }) });
    }
  }

  private flush(path: ProjectPath): void {
    const pending = this.unwritten.get(path);
    this.drop(path);
    if (pending) this.put(path, pending.content);
  }

  private drop(path: ProjectPath): void {
    clearTimeout(this.unwritten.get(path)?.timer);
    this.unwritten.delete(path);
  }

  private put(path: ProjectPath, content: FileContent): void {
    this.send(path, filesUrl(path), { method: 'PUT', body: bytesOf(content) });
  }

  private send(path: ProjectPath, url: string, init: RequestInit): void {
    this.queue = this.queue.then(
      () => this.fetch(url, init).then(() => undefined),
    ).catch((error: unknown) => this.fail(`${ProjectPath.displayName(path)} not saved: ${error instanceof Error ? error.message : String(error)}`));
  }
}

/** What `change` from disk does to the project, given whether it has the file: null for nothing. */
export function diskChange(change: DiskChange, path: ProjectPath, has: boolean, main: ProjectPath): FileChange | null {
  if (change.kind === 'delete') return has && path !== main ? { kind: 'delete', path } : null;
  if (change.kind === 'rename') {
    const from = ProjectPath.parse(change.from ?? '');
    return from && !has ? { kind: 'rename', from, path } : null;
  }
  return { kind: has ? 'update' : 'create', path, content: decode(path, change.content ?? '') };
}

/** The lines of a stream of text, without their line breaks (empty ones left out). */
async function* lines(body: ReadableStream<BufferSource>): AsyncGenerator<string> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = '';
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    const complete = (buffered + read.value).split('\n');
    buffered = complete.pop()!;
    yield* complete.filter(Boolean);
  }
}

function filesUrl(path: ProjectPath): string {
  return `/api/local/files${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** A file's content as the server sends it (base64): text for a Typst file, bytes for any other. */
function decode(path: string, base64: string): FileContent {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return path.endsWith('.typ') ? new TextDecoder().decode(bytes) : bytes;
}

function bytesOf(content: FileContent): Uint8Array<ArrayBuffer> {
  return typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
}

function same(a: FileContent | undefined, b: FileContent): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a !== undefined && a.length === b.length && a.every((byte, i) => byte === b[i]);
}
