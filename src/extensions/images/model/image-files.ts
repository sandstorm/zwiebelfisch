// Image files: which project files are images Typst (and the browser) can show, by name, and their media types.
// See images in ../images.ts.
import { ProjectPath } from '../../../core/paths/paths';
import { FileContent } from '../../../core/project/project';

/** The media type of each image file extension Typst shows. */
const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

/** The image files as an editor's file name pattern. */
export const IMAGE_FILES = `*.{${Object.keys(MEDIA_TYPES)
  .map((extension) => extension.slice(1))
  .join(',')}}`;

/** The image files as a file input's `accept` (`.png,.jpg,…`). */
export const IMAGE_ACCEPT = Object.keys(MEDIA_TYPES).join(',');

/** Whether `path` is an image file (by its extension, in any case: `Logo.PNG`). */
export function isImage(path: ProjectPath): boolean {
  return ProjectPath.extension(path).toLowerCase() in MEDIA_TYPES;
}

/** The image file `path` with `content` as a Blob of its media type, e.g. for an object URL. */
export function imageBlob(path: ProjectPath, content: FileContent): Blob {
  return new Blob([FileContent.bytes(content) as BlobPart], { type: MEDIA_TYPES[ProjectPath.extension(path).toLowerCase()] });
}

/**
 * Where an uploaded image goes: the folder holding most of the project's `images` (the first of equals), else
 * `/images/`. As a prefix to put a name after (`/assets/`).
 */
export function uploadFolder(images: readonly ProjectPath[]): string {
  const counts = new Map<string, number>();
  for (const image of images) {
    const folder = folderOf(image);
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [folder, count] of counts) if (best === null || count > counts.get(best)!) best = folder;
  return best ?? '/images/';
}

/** The folder of `path`, with its slash at the end (`/`, `/chapters/`). */
function folderOf(path: ProjectPath): string {
  return path.slice(0, path.lastIndexOf('/') + 1);
}
