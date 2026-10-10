// Reads a project folder from disk into the widget's file map (the fake repository of the playground).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

/**
 * The files of a project folder on disk, keyed by absolute project path
 * (`<dir>/chapters/a.typ` → `/chapters/a.typ`): Typst files as text,
 * everything else (images, data) as bytes — as the widget takes them.
 */
export function readProjectFiles(dir: string | URL): Record<string, string | Uint8Array> {
  const root = typeof dir === 'string' ? dir : fileURLToPath(dir);
  const files: Record<string, string | Uint8Array> = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    const path = `/${relative(root, file).split(sep).join('/')}`;
    files[path] = path.endsWith('.typ') ? readFileSync(file, 'utf8') : new Uint8Array(readFileSync(file));
  }
  return files;
}
