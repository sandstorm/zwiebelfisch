// Paths: how project files are named and what they are. Two types keep apart what plain strings mixed up: a
// ProjectPath (where a file is in the project) and a PathReference (a path as written in Typst source, which means
// something only relative to its file). Branded strings: free at runtime, usable as keys, unchanged across
// postMessage, Yjs and the server; the compiler refuses one where the other is meant.
// Entry of core/paths/. See docs/architecture/core.typ.

/** An absolute path in the project: `/` and then segments (`/chapters/intro.typ`), never `.`, `..` or empty ones. */
export type ProjectPath = string & { readonly __type: 'ProjectPath' };

/** A path as written in Typst source (`img/logo.png`, `../template.typ`, `/data.csv`): relative to the file it is in. */
export type PathReference = string & { readonly __type: 'PathReference' };

/** A typed name as a path (`ProjectPath.fromName`), or what is wrong with it, for the user. */
export type NamedPath = { readonly kind: 'valid'; readonly path: ProjectPath } | { readonly kind: 'invalid'; readonly error: string };

export const ProjectPath = {
  /** `value` as a project path; null when it is none (relative, `..`, empty segments, a backslash). */
  parse(value: string): ProjectPath | null {
    if (!value.startsWith('/') || value.includes('\\')) return null;
    const segments = value.slice(1).split('/');
    return segments.some((s) => s === '' || s === '.' || s === '..') ? null : (value as ProjectPath);
  },

  /** `value` as a project path, for paths known to be valid (constants, tests); throws for others. */
  of(value: string): ProjectPath {
    const path = ProjectPath.parse(value);
    if (path === null) throw new Error(`Not a project path: ${value}`);
    return path;
  },

  /**
   * The path of a name someone typed ("chapter 2", "parts/intro.typ"), with
   * `extension` added when the name has none. Folders may nest.
   */
  fromName(name: string, extension: string): NamedPath {
    const trimmed = name.trim().replace(/^\.?\/+/, '');
    if (trimmed === '') return { kind: 'invalid', error: 'Please enter a name.' };
    const named = ProjectPath.parse(`/${trimmed}`);
    if (named === null) return { kind: 'invalid', error: 'Names cannot contain "\\", "..", or empty folder names.' };
    const last = trimmed.slice(trimmed.lastIndexOf('/') + 1);
    return { kind: 'valid', path: last.includes('.') ? named : ProjectPath.of(`${named}${extension}`) };
  },

  /**
   * Where `reference`, written in `file`, points, as Typst resolves it: `/x`
   * from the project root, anything else from the folder of `file`. Null when
   * it leaves the project.
   */
  resolve(file: ProjectPath, reference: PathReference): ProjectPath | null {
    const segments = reference.startsWith('/') ? [] : file.split('/').slice(1, -1);
    for (const segment of reference.split('/')) {
      if (segment === '..') {
        if (segments.pop() === undefined) return null;
      } else if (segment !== '' && segment !== '.') {
        segments.push(segment);
      }
    }
    return segments.length === 0 ? null : (`/${segments.join('/')}` as ProjectPath);
  },

  /** How `file` refers to `target` in Typst: relative in the same folder tree, else from the project root. */
  referenceTo(file: ProjectPath, target: ProjectPath): PathReference {
    const folder = file.slice(0, file.lastIndexOf('/') + 1);
    return (target.startsWith(folder) ? target.slice(folder.length) : target) as PathReference;
  },

  /**
   * Whether `path` is Typst source (`.typ`): text, one TypstDocument each, edited in the Visual / Source views. Every
   * other file is bytes (or text) the project only stores; extensions decide by name what they do with it.
   */
  isTypst(path: ProjectPath): boolean {
    return path.endsWith('.typ');
  },

  /** The path as shown to people: without the leading slash. */
  displayName(path: ProjectPath): string {
    return path.slice(1);
  },

  /** The last segment: the file's (or folder's) name (`/chapters/intro.typ` → `intro.typ`). */
  name(path: ProjectPath): string {
    return path.slice(path.lastIndexOf('/') + 1);
  },

  /** The extension including the dot (`.typ`), or '' when there is none. */
  extension(path: ProjectPath): string {
    const name = ProjectPath.name(path);
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot) : '';
  },
};

export const PathReference = {
  /** `written`, a path as it stands in Typst source (any string is one; it is resolved against its file). */
  of(written: string): PathReference {
    return written as PathReference;
  },
};
