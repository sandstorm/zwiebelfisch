// Reading order: the project's Typst files in the order the main file includes them, and a file's neighbours in it.
// See project.ts.
import { findPathReferences } from './path-references';
import { resolvePath } from './paths';
import type { ProjectFiles } from './project';

/**
 * The main file, then every file it `#include`s, depth first, in the order
 * Typst reads them (a nested include comes right after the text before it).
 * Missing files, imports, a file included a second time and include cycles
 * are left out. Empty when there is no main file.
 */
export function readingOrder(files: ProjectFiles, main: string): string[] {
  const order: string[] = [];
  const visit = (path: string) => {
    const text = files[path];
    if (typeof text !== 'string' || order.includes(path)) return;
    order.push(path);
    for (const reference of findPathReferences(text)) {
      if (reference.call !== 'include') continue;
      const target = resolvePath(path, reference.path);
      if (target !== null) visit(target);
    }
  };
  visit(main);
  return order;
}

/**
 * The files read before and after `path` (null at the end), or null when
 * `path` is the main file or not included at all.
 */
export function neighbours(files: ProjectFiles, main: string, path: string): { previous: string; next: string | null } | null {
  const order = readingOrder(files, main);
  const index = order.indexOf(path);
  if (index <= 0) return null;
  return { previous: order[index - 1], next: order[index + 1] ?? null };
}
