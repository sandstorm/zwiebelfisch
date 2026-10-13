// The file tree as data: folders from paths, the rows shown, keyboard moves, moving files. Pure. See files in
// ../files.ts.
import { ProjectPath } from '../../../core/paths/paths';

/**
 * The project's files as a tree: folders come from the paths, plus `folders`
 * (empty folders made in the panel). Each folder lists the main file `main` (if
 * it holds it) first, then its folders, then its files, both by name (numbers by
 * value: 2 before 10).
 */
export function buildTree(paths: readonly ProjectPath[], folders: Iterable<ProjectPath> = [], main?: ProjectPath): TreeEntry {
  const root: TreeEntry = { kind: 'folder', path: null, name: '', children: [] };
  const index = new Map<Folder, TreeEntry>([[null, root]]);
  const folder = (path: Folder): TreeEntry => {
    let entry = index.get(path);
    if (!entry && path !== null) {
      entry = { kind: 'folder', path, name: ProjectPath.name(path), children: [] };
      index.set(path, entry);
      folder(folderOf(path)).children.push(entry);
    }
    return entry!;
  };
  for (const path of folders) folder(path);
  for (const path of paths) folder(folderOf(path)).children.push({ kind: 'file', path, name: ProjectPath.name(path), children: [] });
  const rank = (entry: TreeEntry) => (entry.path === main ? 0 : entry.kind === 'folder' ? 1 : 2);
  for (const entry of index.values()) entry.children.sort((a, b) => rank(a) - rank(b) || collator.compare(a.name, b.name));
  return root;
}

/** A folder (a path, like a file's, without a trailing slash), or null for the top level. */
export type Folder = ProjectPath | null;

/** A file, or a folder (the root's `path` is null). */
export interface TreeEntry {
  kind: 'file' | 'folder';
  path: Folder;
  name: string;
  /** Folders only: sorted, the main file first, then folders. */
  children: TreeEntry[];
}

/** One visible line of the tree. */
export interface Row {
  kind: 'file' | 'folder';
  path: ProjectPath;
  name: string;
  /** 0 at the top level. */
  depth: number;
  /** Folders only. */
  expanded?: boolean;
  /** The folder it is in. */
  parent: Folder;
}

/** What a key does in the tree: move the focus, expand or collapse a folder, or open a file. */
export interface TreeKeyMove {
  kind: 'focus' | 'expand' | 'collapse' | 'open';
  path: ProjectPath;
}

/** The rows shown when the folders in `expanded` are open, top to bottom. */
export function visibleRows(root: TreeEntry, expanded: ReadonlySet<ProjectPath>): Row[] {
  const rows: Row[] = [];
  const walk = (folder: TreeEntry, depth: number) => {
    for (const entry of folder.children) {
      const path = entry.path!; // only the root has none
      const isFolder = entry.kind === 'folder';
      const open = isFolder && expanded.has(path);
      rows.push({ kind: entry.kind, path, name: entry.name, depth, parent: folder.path, ...(isFolder ? { expanded: open } : {}) });
      if (open) walk(entry, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

/** The folder `path` is in: '/a/b.typ' → '/a', '/b.typ' → null (the top level). */
export function folderOf(path: ProjectPath): Folder {
  return ProjectPath.parse(path.slice(0, path.lastIndexOf('/')));
}

/** The folders around `path`, outermost first. */
export function ancestorsOf(path: ProjectPath): ProjectPath[] {
  const result: ProjectPath[] = [];
  for (let folder = folderOf(path); folder !== null; folder = folderOf(folder)) result.unshift(folder);
  return result;
}

/** The files in `folder`, at any depth, in the order of `paths`. */
export function filesUnder(paths: readonly ProjectPath[], folder: ProjectPath): ProjectPath[] {
  return paths.filter((path) => path.startsWith(`${folder}/`));
}

/**
 * The renames that put `source` (a file or a folder with everything in it)
 * at `target`. None when nothing would change or a folder would go into itself.
 */
export function relocate(paths: readonly ProjectPath[], source: ProjectPath, target: ProjectPath): { from: ProjectPath; path: ProjectPath }[] {
  if (source === target || target.startsWith(`${source}/`)) return [];
  if (paths.includes(source)) return [{ from: source, path: target }];
  return filesUnder(paths, source).map((from) => ({ from, path: ProjectPath.of(target + from.slice(source.length)) }));
}

/** What `key` does with the focus on `current` (null: nothing focused yet); null when nothing. */
export function navigate(rows: readonly Row[], current: ProjectPath | null, key: string): TreeKeyMove | null {
  const index = rows.findIndex((row) => row.path === current);
  if (index < 0) return FOCUS_KEYS.has(key) && rows.length > 0 ? { kind: 'focus', path: rows[0].path } : null;
  return Object.hasOwn(KEYS, key) ? KEYS[key](rows, index) : null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const FOCUS_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

const KEYS: Record<string, (rows: readonly Row[], index: number) => TreeKeyMove | null> = {
  ArrowDown: (rows, i) => focusOn(rows, i, i + 1),
  ArrowUp: (rows, i) => focusOn(rows, i, i - 1),
  Home: (rows, i) => focusOn(rows, i, 0),
  End: (rows, i) => focusOn(rows, i, rows.length - 1),
  /** A closed folder opens; an open one hands the focus to its first child. */
  ArrowRight: (rows, i) => {
    const row = rows[i];
    if (row.kind !== 'folder') return null;
    if (!row.expanded) return { kind: 'expand', path: row.path };
    return rows[i + 1]?.parent === row.path ? focusOn(rows, i, i + 1) : null;
  },
  /** An open folder closes; anything else hands the focus to its folder. */
  ArrowLeft: (rows, i) => {
    const row = rows[i];
    return row.expanded ? { kind: 'collapse', path: row.path } : focusOn(rows, i, rows.findIndex((r) => r.path === row.parent));
  },
  Enter: (rows, i) => {
    const row = rows[i];
    if (row.kind === 'file') return { kind: 'open', path: row.path };
    return row.expanded ? { kind: 'collapse', path: row.path } : { kind: 'expand', path: row.path };
  },
};

/** Focus on `target`, unless it is missing or already focused. */
function focusOn(rows: readonly Row[], index: number, target: number): TreeKeyMove | null {
  return target !== index && rows[target] ? { kind: 'focus', path: rows[target].path } : null;
}
