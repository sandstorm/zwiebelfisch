// Reading order: the Typst files in the order the main file includes them, and a file's neighbours in it.
// See document-links.ts.
import { ProjectPath } from '../paths/paths';
import { provideDocumentLinks } from './find-links';

/** The text of the Typst file `path`; undefined when there is none (missing, or not a Typst file). */
export type ReadText = (path: ProjectPath) => string | undefined;

/**
 * The main file, then every file it `#include`s, depth first, in the order
 * Typst reads them (a nested include comes right after the text before it).
 * Missing files, imports, a file included a second time and include cycles
 * are left out. Empty when there is no main file.
 */
export function readingOrder(read: ReadText, main: ProjectPath): ProjectPath[] {
  const order: ProjectPath[] = [];
  const visit = (path: ProjectPath) => {
    const text = read(path);
    if (text === undefined || order.includes(path)) return;
    order.push(path);
    for (const reference of provideDocumentLinks(text)) {
      if (reference.call !== 'include') continue;
      const target = ProjectPath.resolve(path, reference.path);
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
export function neighbours(read: ReadText, main: ProjectPath, path: ProjectPath): { previous: ProjectPath; next: ProjectPath | null } | null {
  const order = readingOrder(read, main);
  const index = order.indexOf(path);
  if (index <= 0) return null;
  return { previous: order[index - 1], next: order[index + 1] ?? null };
}
