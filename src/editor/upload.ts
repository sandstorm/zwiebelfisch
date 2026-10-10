import { fileKind } from './paths';
import type { FileChange } from './project';

/** The create changes for uploaded files: `.typ` files as text, everything else as bytes. */
export async function uploadChanges(files: File[]): Promise<FileChange[]> {
  return Promise.all(
    files.map(async (file): Promise<FileChange> => {
      const path = `/${file.name.replace(/[/\\]/g, '_')}`;
      const content = fileKind(path) === 'typst' ? await file.text() : new Uint8Array(await file.arrayBuffer());
      return { kind: 'create', path, content };
    }),
  );
}
