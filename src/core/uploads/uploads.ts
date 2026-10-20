import { type FileChange, type FileContent } from '../project/project';
import { ProjectPath } from '../paths/paths';

/**
 * The create changes for uploaded files: each at the top of the project under its name (`/` and `\` replaced by
 * `_`; a name like `..` is left out), `.typ` files as text, everything else as bytes.
 *
 * Files picked or dropped from the computer enter the project here, used by:
 * - the widget (editor/widget), for files dropped into the Typst editors
 * - the file panel (extensions/files)
 * - image uploads (extensions/images)
 */
export async function uploadChanges(files: readonly UploadedFile[]): Promise<FileChange[]> {
  const changes = await Promise.all(
    files.map(async (file): Promise<FileChange | null> => {
      const path = ProjectPath.parse(`/${file.name.replace(/[/\\]/g, '_')}`); // null for a name like ".."
      if (path === null) return null;
      const content = ProjectPath.isTypst(path) ? await file.text() : new Uint8Array(await file.arrayBuffer());
      return { kind: 'create', path, content };
    }),
  );
  return changes.filter((change) => change !== null);
}

/**
 * Where an upload of `content` named `path` goes: a file with the same content (`name.png`, `name-2.png`, …), else
 * the first free one of those names (browsers name every pasted screenshot `image.png`). `contentOf` reads the
 * project's files.
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

/** A file from the computer, as far as uploads read it (a DOM `File` is one; core names no DOM type). */
export interface UploadedFile {
  readonly name: string;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function sameContent(a: FileContent, b: FileContent): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}
