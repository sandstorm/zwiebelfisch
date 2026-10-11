// Tests for docs-folder.ts: the path guard, atomic writes, the snapshot, and which changes on disk reach the page.
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocsFolder } from './docs-folder';

let base: string;
let root: string;
let folder: DocsFolder;
const bytes = (text: string) => new TextEncoder().encode(text);

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'docs-folder-'));
  root = join(base, 'docs');
  await mkdir(join(root, '10_guide'), { recursive: true });
  await mkdir(join(root, 'fonts'));
  await writeFile(join(root, '10_guide/02_features.typ'), '= Features\n');
  folder = new DocsFolder(root, ['fonts']);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe('the path guard', () => {
  it.each([
    ['an absolute path', '/etc/passwd'],
    ['a parent folder', '../outside.typ'],
    ['a parent folder in the middle', '10_guide/../../outside.typ'],
    ['a current folder segment', './10_guide/02_features.typ'],
    ['an empty segment', '10_guide//02_features.typ'],
    ['a backslash', '10_guide\\02_features.typ'],
    ['a hidden file', '.env'],
    ['a hidden folder', '.git/config'],
    ['a build output', 'fonts/x.ttf'],
    ['a drive letter', 'C:/x.typ'],
    ['nothing', ''],
  ])('refuses %s', async (_, path) => {
    await expect(folder.write(path, bytes('x'))).rejects.toMatchObject({ status: 400 });
    expect(await readdir(base)).toEqual(['docs']);
  });

  it('refuses a symlinked folder leading out of docs/, and creates nothing behind it', async () => {
    await mkdir(join(base, 'outside'));
    await symlink(join(base, 'outside'), join(root, 'out'));
    await expect(folder.write('out/new/x.typ', bytes('x'))).rejects.toMatchObject({ status: 403 });
    expect(await readdir(join(base, 'outside'))).toEqual([]);
  });

  it('refuses a symlinked file (it could point anywhere)', async () => {
    await writeFile(join(base, 'secret.txt'), 'secret');
    await symlink(join(base, 'secret.txt'), join(root, 'link.txt'));
    await expect(folder.write('link.txt', bytes('x'))).rejects.toMatchObject({ status: 403 });
    expect(await readFile(join(base, 'secret.txt'), 'utf8')).toBe('secret');
  });

  it('refuses to write over a folder', async () => {
    await expect(folder.write('10_guide', bytes('x'))).rejects.toMatchObject({ status: 403 });
  });
});

describe('writing', () => {
  it('writes atomically, creating folders, and leaves no temporary file', async () => {
    await folder.write('10_guide/02_features.typ', bytes('= New\n'));
    await folder.write('assets/new/logo.png', new Uint8Array([137, 80, 78, 71]));
    expect(await readFile(join(root, '10_guide/02_features.typ'), 'utf8')).toBe('= New\n');
    expect([...(await readFile(join(root, 'assets/new/logo.png')))]).toEqual([137, 80, 78, 71]);
    expect(await readdir(join(root, '10_guide'))).toEqual(['02_features.typ']);
  });

  it('deletes a file; a missing one is a 404', async () => {
    await folder.delete('10_guide/02_features.typ');
    expect(await readdir(join(root, '10_guide'))).toEqual([]);
    await expect(folder.delete('10_guide/02_features.typ')).rejects.toMatchObject({ status: 404 });
  });

  it('renames into a new folder, but never over an existing file', async () => {
    await folder.rename('10_guide/02_features.typ', 'chapters/features.typ');
    expect(await readFile(join(root, 'chapters/features.typ'), 'utf8')).toBe('= Features\n');
    await writeFile(join(root, '10_guide/other.typ'), 'other');
    await expect(folder.rename('10_guide/other.typ', 'chapters/features.typ')).rejects.toMatchObject({ status: 409 });
    await expect(folder.rename('10_guide/gone.typ', 'chapters/gone.typ')).rejects.toMatchObject({ status: 404 });
    await expect(folder.rename('10_guide/other.typ', '../other.typ')).rejects.toMatchObject({ status: 400 });
  });
});

describe('changes on disk for the page', () => {
  it('reports a change made by someone else: text files as text, others as base64, deletions', async () => {
    await writeFile(join(root, '10_guide/02_features.typ'), '= Changed\n');
    expect(await folder.changeFor(join(root, '10_guide/02_features.typ'))).toEqual({ path: '10_guide/02_features.typ', text: '= Changed\n' });
    await writeFile(join(root, 'logo.png'), new Uint8Array([1, 2, 3]));
    expect(await folder.changeFor(join(root, 'logo.png'))).toEqual({ path: 'logo.png', base64: 'AQID' });
    await rm(join(root, 'logo.png'));
    expect(await folder.changeFor(join(root, 'logo.png'))).toEqual({ path: 'logo.png', deleted: true });
  });

  it('skips the event of its own last write, delete or rename (no echo), but not a later change by someone else', async () => {
    const file = join(root, '10_guide/02_features.typ');
    await folder.write('10_guide/02_features.typ', bytes('= Mine\n'));
    expect(await folder.changeFor(file)).toBeNull();
    await writeFile(file, '= Theirs\n');
    expect(await folder.changeFor(file)).toEqual({ path: '10_guide/02_features.typ', text: '= Theirs\n' });
    await folder.rename('10_guide/02_features.typ', '10_guide/moved.typ');
    expect(await folder.changeFor(file)).toBeNull();
    expect(await folder.changeFor(join(root, '10_guide/moved.typ'))).toBeNull();
    await folder.delete('10_guide/moved.typ');
    expect(await folder.changeFor(join(root, '10_guide/moved.typ'))).toBeNull();
  });

  it('says nothing about hidden files (its temporary files), build outputs, folders or files outside', async () => {
    await writeFile(join(root, '.abc.docs-files.tmp'), 'x');
    await writeFile(join(root, 'fonts/a.ttf'), 'x');
    expect(await folder.changeFor(join(root, '.abc.docs-files.tmp'))).toBeNull();
    expect(await folder.changeFor(join(root, 'fonts/a.ttf'))).toBeNull();
    expect(await folder.changeFor(join(root, '10_guide'))).toBeNull();
    expect(await folder.changeFor(join(base, 'elsewhere.typ'))).toBeNull();
    expect(folder.contains(join(base, 'docs-other/x.typ'))).toBe(false);
  });

  it('takes a snapshot of every file the page may hear of: no hidden files, build outputs or folders', async () => {
    await writeFile(join(root, '.abc.docs-files.tmp'), 'x');
    await writeFile(join(root, 'fonts/a.ttf'), 'x');
    await writeFile(join(root, 'logo.png'), new Uint8Array([1, 2, 3]));
    expect(await folder.snapshot()).toEqual([
      { path: '10_guide/02_features.typ', text: '= Features\n' },
      { path: 'logo.png', base64: 'AQID' },
    ]);
  });

  it('watches the folder: a change by someone else reaches the listener, its own write does not', async () => {
    const heard: unknown[] = [];
    const stop = folder.watch((change) => heard.push(change));
    try {
      await folder.write('10_guide/02_features.typ', bytes('= Mine\n'));
      await writeFile(join(root, '10_guide/other.typ'), '= Theirs\n');
      await vi.waitFor(() => expect(heard).toContainEqual({ path: '10_guide/other.typ', text: '= Theirs\n' }));
      expect(heard).not.toContainEqual(expect.objectContaining({ path: '10_guide/02_features.typ' }));
    } finally {
      stop();
    }
  });
});
