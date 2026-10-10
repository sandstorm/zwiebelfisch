// uploadChanges: uploaded files as project changes (names, kinds). See files.ts.
import { type FileChange } from '../../core/project/project';
import { ProjectPath } from '../../core/paths/paths';

/** The create changes for uploaded files: `.typ` files as text, everything else as bytes. */
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
