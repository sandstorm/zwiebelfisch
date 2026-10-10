// Paths: how project files are named and what they are (file kinds, display names, names people type, Typst path
// resolution). Pure functions on strings, so every module agrees on paths without needing a Project.
// Entry of core/paths/. See ARCHITECTURE.md, "Paths".

/** What the widget can do with a file: edit it, preview it as an image, edit it as a spreadsheet (IronCalc, `.ic`), or only list it. */
export type FileKind = 'typst' | 'image' | 'spreadsheet' | 'data';

const IMAGE = /\.(png|jpe?g|gif|svg|webp)$/i;

export function fileKind(path: string): FileKind {
  if (path.endsWith('.typ')) return 'typst';
  if (path.endsWith('.ic')) return 'spreadsheet';
  return IMAGE.test(path) ? 'image' : 'data';
}

/** A path as shown to people: without the leading slash. */
export function displayName(path: string): string {
  return path.slice(1);
}

/**
 * Turns a name someone typed ("chapter 2", "parts/intro.typ") into a project
 * path. Adds `extension` when the name has none. Folders may nest.
 */
export function toPath(name: string, extension: string): { path: string } | { error: string } {
  const trimmed = name.trim().replace(/^\.?\/+/, '');
  if (trimmed === '') return { error: 'Please enter a name.' };
  const segments = trimmed.split('/');
  if (trimmed.includes('\\') || segments.some((s) => s === '' || s === '.' || s === '..')) {
    return { error: 'Names cannot contain "\\", "..", or empty folder names.' };
  }
  const last = segments[segments.length - 1];
  return { path: `/${trimmed}${last.includes('.') ? '' : extension}` };
}

/** How `file` refers to `target` in Typst: relative in the same folder tree, else project-absolute. */
export function referencePath(file: string, target: string): string {
  const folder = file.slice(0, file.lastIndexOf('/') + 1);
  return target.startsWith(folder) ? target.slice(folder.length) : target;
}

/** The extension of `path` including the dot, or '' when it has none. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot) : '';
}

const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

/** The image file `path` with `content` as a Blob of its media type, e.g. for an object URL. */
export function imageBlob(path: string, content: string | Uint8Array): Blob {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return new Blob([bytes as BlobPart], { type: IMAGE_TYPES[extensionOf(path).toLowerCase()] });
}

/**
 * The project path a Typst path in `file` refers to, as Typst resolves it:
 * `/x` from the project root, anything else from the folder of `file`.
 * Null when it leaves the project.
 */
export function resolvePath(file: string, reference: string): string | null {
  const base = reference.startsWith('/') ? [] : file.split('/').slice(1, -1);
  const segments: string[] = base;
  for (const segment of reference.split('/')) {
    if (segment === '..') {
      if (segments.pop() === undefined) return null;
    } else if (segment !== '' && segment !== '.') {
      segments.push(segment);
    }
  }
  return segments.length === 0 ? null : `/${segments.join('/')}`;
}
