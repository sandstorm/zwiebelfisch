/** What the widget can do with a file: edit it, preview it as an image, or only list it. */
export type FileKind = 'typst' | 'image' | 'data';

const IMAGE = /\.(png|jpe?g|gif|svg|webp)$/i;

export function fileKind(path: string): FileKind {
  if (path.endsWith('.typ')) return 'typst';
  return IMAGE.test(path) ? 'image' : 'data';
}

/** A path as shown to people: without the leading slash. */
export function displayName(path: string): string {
  return path.slice(1);
}

/**
 * Turns a name someone typed ("chapter 2", "parts/intro.typ") into a project
 * path. Adds `extension` when the name has none. At most one folder level.
 */
export function toPath(name: string, extension: string): { path: string } | { error: string } {
  const trimmed = name.trim().replace(/^\.?\/+/, '');
  if (trimmed === '') return { error: 'Please enter a name.' };
  const segments = trimmed.split('/');
  if (trimmed.includes('\\') || segments.some((s) => s === '' || s === '.' || s === '..')) {
    return { error: 'Names cannot contain "\\", "..", or empty folder names.' };
  }
  if (segments.length > 2) return { error: 'Files can be at most one folder deep.' };
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
