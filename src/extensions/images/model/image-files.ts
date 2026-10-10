// Image files: which project files are images Typst (and the browser) can show, by name, and their media types.
// See ../images.ts.
import { ProjectPath } from '../../../core/paths/paths';

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

/** Whether `path` is an image file (by its extension, in any case: `Logo.PNG`). */
export function isImage(path: ProjectPath): boolean {
  return ProjectPath.extension(path).toLowerCase() in MEDIA_TYPES;
}

/** The image file `path` with `content` as a Blob of its media type, e.g. for an object URL. */
export function imageBlob(path: ProjectPath, content: string | Uint8Array): Blob {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return new Blob([bytes as BlobPart], { type: MEDIA_TYPES[ProjectPath.extension(path).toLowerCase()] });
}
