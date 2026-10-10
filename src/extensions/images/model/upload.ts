// Where an uploaded image goes in the project: the name it gets next to the project's other files (its path from
// the file name is core/uploads'). See ../images.ts.
import type { FileContent } from '../../../core/project/project';
import { ProjectPath } from '../../../core/paths/paths';

/**
 * Where an upload of `content` named `path` goes: a file with the same
 * content (`name.png`, `name-2.png`, …), else the first free one of those
 * names (browsers name every pasted screenshot `image.png`). `contentOf`
 * reads the project's files.
 */
export function uploadTarget(path: ProjectPath, content: FileContent, contentOf: (path: ProjectPath) => FileContent | undefined): ProjectPath {
  const extension = ProjectPath.extension(path);
  const stem = path.slice(0, path.length - extension.length);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? path : ProjectPath.of(`${stem}-${n}${extension}`);
    const existing = contentOf(candidate);
    if (existing === undefined || sameContent(existing, content)) return candidate;
  }
}

function sameContent(a: FileContent, b: FileContent): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}
