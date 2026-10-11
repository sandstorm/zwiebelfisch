// DocsFolder: the docs/ folder as the docs-files plugin (plugin.ts) writes and watches it. Node only.
// Every path comes from the page, so each one goes through the guard here: relative to docs/, no "..", no hidden
// files, nothing in the build outputs (docs/fonts/), no symlink leading out. See docs/30_architecture/11_development.typ.
import { randomBytes } from 'node:crypto';
import { watch } from 'node:fs';
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { type DiskChange, isTextPath } from './protocol.ts';

/** A request the folder refuses, with the HTTP status that says why. */
export class DocsFilesError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * The files under `root`, by paths relative to it (`10_guide/02_features.typ`). Writes are atomic (a hidden temporary file
 * renamed over the target). It remembers what it wrote last per path, so `watch` skips the event for the folder's own
 * write (no echo to the page that made it).
 */
export class DocsFolder {
  readonly #written = new Map<string, Buffer | null>();
  #realRoot: Promise<string> | undefined;

  readonly root: string;

  /** `outputs`: generated folders below `root` (gitignored, e.g. `fonts`), neither written nor reported. */
  constructor(
    root: string,
    private readonly outputs: readonly string[] = [],
  ) {
    this.root = resolve(root);
  }

  /** Writes `bytes` to `path`, creating the file and its folders as needed. */
  async write(path: string, bytes: Uint8Array): Promise<void> {
    const file = await this.#resolve(path);
    await mkdir(dirname(file), { recursive: true });
    const temporary = join(dirname(file), `.${randomBytes(6).toString('hex')}.docs-files.tmp`);
    try {
      await writeFile(temporary, bytes);
      await rename(temporary, file);
    } finally {
      await rm(temporary, { force: true });
    }
    this.#written.set(path, Buffer.from(bytes));
  }

  async delete(path: string): Promise<void> {
    const file = await this.#resolve(path);
    await this.#mustExist(file, path);
    await rm(file);
    this.#written.set(path, null);
  }

  /** Moves `from` to `to`; refuses to replace an existing file. */
  async rename(from: string, to: string): Promise<void> {
    const source = await this.#resolve(from);
    const target = await this.#resolve(to);
    await this.#mustExist(source, from);
    if (await exists(target)) throw new DocsFilesError(`${to} already exists`, 409);
    await mkdir(dirname(target), { recursive: true });
    await rename(source, target);
    this.#written.set(from, null);
    this.#written.set(to, await readFile(target));
  }

  /** Whether the absolute `file` (a watcher's path) lies in the folder. */
  contains(file: string): boolean {
    return file.startsWith(this.root + sep);
  }

  /**
   * Calls `listener` with each change on disk (another editor, a checkout), not with the folder's own writes; returns
   * the stop. The same change may come more than once (the page ignores what it knows already).
   */
  watch(listener: (change: DiskChange) => void): () => void {
    const watcher = watch(this.root, { recursive: true }, (_, name) => {
      if (name) void this.changeFor(join(this.root, name.toString())).then((change) => change && listener(change));
    });
    return () => watcher.close();
  }

  /** Every file the page may hear of, as it is now (none deleted), sorted by path. */
  async snapshot(): Promise<DiskChange[]> {
    const entries = await readdir(this.root, { recursive: true, withFileTypes: true });
    const paths = entries
      .filter((entry) => entry.isFile())
      .map((entry) => relative(this.root, join(entry.parentPath, entry.name)).split(sep).join('/'))
      .filter((path) => !this.#problem(path))
      .sort();
    return Promise.all(paths.map(async (path) => diskChange(path, await readFile(join(this.root, ...path.split('/'))))));
  }

  /**
   * What to tell the page about a watcher's event for the absolute `file`: its content now, or that it is gone; null
   * when the page must not hear of it (outside the folder, refused by the guard, a folder, or the folder's own last
   * write).
   */
  async changeFor(file: string): Promise<DiskChange | null> {
    if (!this.contains(file)) return null;
    const path = relative(this.root, file).split(sep).join('/');
    if (this.#problem(path)) return null;
    const bytes = await readFile(file).catch((error: NodeJS.ErrnoException) => (error.code === 'ENOENT' ? null : undefined));
    if (bytes === undefined || sameBytes(this.#written.get(path), bytes)) return null;
    return diskChange(path, bytes);
  }

  /** The absolute file for `path`, if the guard lets it through; else throws a `DocsFilesError`. */
  async #resolve(path: string): Promise<string> {
    const problem = this.#problem(path);
    if (problem) throw new DocsFilesError(`${problem}: ${JSON.stringify(path)}`, 400);
    const root = await (this.#realRoot ??= realpath(this.root));
    const file = join(root, ...path.split('/'));
    // the nearest existing folder above it must really be in docs/ (no symlinked folder leading out)
    const folder = await realpath(await nearestExisting(dirname(file)));
    if (folder !== root && !folder.startsWith(root + sep)) throw new DocsFilesError(`Outside docs/: ${path}`, 403);
    const stats = await lstat(file).catch(() => null);
    if (stats && !stats.isFile()) throw new DocsFilesError(`Not a regular file: ${path}`, 403);
    return file;
  }

  /** Why `path` is no path the folder accepts, or null. */
  #problem(path: string): string | null {
    if (typeof path !== 'string' || path.length === 0 || path.length > 512) return 'Not a path';
    if (/[\\\0]/.test(path) || path.startsWith('/') || /^[a-z]:/i.test(path)) return 'Not a relative path';
    const segments = path.split('/');
    if (segments.some((segment) => segment === '' || segment.startsWith('.'))) return 'Empty, "..", or hidden path segment';
    if (this.outputs.includes(segments[0])) return 'A build output';
    return null;
  }

  async #mustExist(file: string, path: string): Promise<void> {
    if (!(await exists(file))) throw new DocsFilesError(`There is no file ${path}`, 404);
  }
}

async function exists(file: string): Promise<boolean> {
  return (await lstat(file).catch(() => null)) !== null;
}

async function nearestExisting(folder: string): Promise<string> {
  while (!(await exists(folder))) folder = dirname(folder);
  return folder;
}

/** A file's content (or its absence) as it travels to the page. */
function diskChange(path: string, bytes: Buffer | null): DiskChange {
  if (bytes === null) return { path, deleted: true };
  return isTextPath(path) ? { path, text: bytes.toString('utf8') } : { path, base64: bytes.toString('base64') };
}

function sameBytes(written: Buffer | null | undefined, now: Buffer | null): boolean {
  if (written === undefined) return false;
  return written === null || now === null ? written === now : written.equals(now);
}
