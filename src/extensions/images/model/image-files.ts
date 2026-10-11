// Image files: which project files are images Typst (and the browser) can show, by name, and their media types.
// See ../images.ts.
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

/** The image files as a custom editor's file name pattern. */
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
