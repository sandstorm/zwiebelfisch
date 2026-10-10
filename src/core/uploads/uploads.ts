// Uploads: files from the computer (picked or dropped) become project changes, parsed at the edge: a name becomes a
// ProjectPath at the top of the project, the kind decides text or bytes. Entry of core/uploads/. Used by the file
// panel (extensions/files) and image uploads (extensions/images). See ARCHITECTURE.md, "File panel".
import { type FileChange } from '../project/project';
import { ProjectPath } from '../paths/paths';

/**
 * The create changes for uploaded files: each at the top of the project under its name (`/` and `\` replaced by
 * `_`; a name like `..` is left out), `.typ` files as text, everything else as bytes.
 */
export async function uploadChanges(files: File[]): Promise<FileChange[]> {
  const changes = await Promise.all(
    files.map(async (file): Promise<FileChange | null> => {
      const path = ProjectPath.parse(`/${file.name.replace(/[/\\]/g, '_')}`); // null for a name like ".."
      if (path === null) return null;
      const content = ProjectPath.kind(path) === 'typst' ? await file.text() : new Uint8Array(await file.arrayBuffer());
      return { kind: 'create', path, content };
    }),
  );
  return changes.filter((change) => change !== null);
}
