import { type FileChange } from '../project/project';
import { ProjectPath } from '../paths/paths';

/**
 * The create changes for uploaded files: each at the top of the project under its name (`/` and `\` replaced by
 * `_`; a name like `..` is left out), `.typ` files as text, everything else as bytes.
 *
 * Files from the computer (picked or dropped) enter the project here, so every feature names and reads them the same
 * way: a file name becomes a ProjectPath at the top of the project, and the kind decides text or bytes. Used by the
 * file panel (extensions/files) and image uploads (extensions/images); applying the changes is theirs.
 * See docs/30_architecture/02_core.typ.
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

/** A file from the computer, as far as uploads read it (a DOM `File` is one; core names no DOM type). */
export interface UploadedFile {
  readonly name: string;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
