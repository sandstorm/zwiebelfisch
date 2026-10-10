// The file tree as data: folders from paths, the rows shown for the expanded folders, keyboard moves, and
// moving files or folders. Pure. See tree.ts.

/** A file, or a folder (`path` without a trailing slash; the root is ''). */
export interface TreeEntry {
  kind: 'file' | 'folder';
  path: string;
  name: string;
  /** Folders only: sorted, folders first. */
  children: TreeEntry[];
}

/** One visible line of the tree. */
export interface Row {
  kind: 'file' | 'folder';
  path: string;
  name: string;
  /** 0 at the top level. */
  depth: number;
  /** Folders only. */
  expanded?: boolean;
  /** The folder it is in ('' for the top level). */
  parent: string;
}

/** What a key does in the tree: move the focus, expand or collapse a folder, or open a file. */
export type Move = { focus: string } | { expand: string } | { collapse: string } | { open: string };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * The project's files as a tree: folders come from the paths, plus `folders`
 * (empty folders made in the panel). Each folder lists its folders first,
 * then its files, both by name (numbers by value: 2 before 10).
 */
export function buildTree(paths: readonly string[], folders: Iterable<string> = []): TreeEntry {
  const root: TreeEntry = { kind: 'folder', path: '', name: '', children: [] };
  const index = new Map<string, TreeEntry>([['', root]]);
  const folder = (path: string): TreeEntry => {
    let entry = index.get(path);
    if (!entry) {
      entry = { kind: 'folder', path, name: nameOf(path), children: [] };
      index.set(path, entry);
      folder(folderOf(path)).children.push(entry);
    }
    return entry;
  };
  for (const path of folders) folder(path);
  for (const path of paths) folder(folderOf(path)).children.push({ kind: 'file', path, name: nameOf(path), children: [] });
  for (const entry of index.values()) entry.children.sort(compare);
  return root;
}

/** The rows shown when the folders in `expanded` are open, top to bottom. */
export function visibleRows(root: TreeEntry, expanded: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  const walk = (folder: TreeEntry, depth: number) => {
    for (const entry of folder.children) {
      const isFolder = entry.kind === 'folder';
      const open = isFolder && expanded.has(entry.path);
      rows.push({ kind: entry.kind, path: entry.path, name: entry.name, depth, parent: folder.path, ...(isFolder ? { expanded: open } : {}) });
      if (open) walk(entry, depth + 1);
    }
  };
  walk(root, 0);
  return rows;
}

/** The folder `path` is in: '/a/b.typ' → '/a', '/b.typ' → ''. */
export function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'));
}

/** The folders around `path`, outermost first. */
export function ancestorsOf(path: string): string[] {
  const result: string[] = [];
  for (let folder = folderOf(path); folder !== ''; folder = folderOf(folder)) result.unshift(folder);
  return result;
}

/** The files in `folder`, at any depth, in the order of `paths`. */
export function filesUnder(paths: readonly string[], folder: string): string[] {
  return paths.filter((path) => path.startsWith(`${folder}/`));
}

/**
 * The renames that put `source` (a file or a folder with everything in it)
 * at `target`. None when nothing would change or a folder would go into itself.
 */
export function relocate(paths: readonly string[], source: string, target: string): { from: string; path: string }[] {
  if (source === target || target.startsWith(`${source}/`)) return [];
  if (paths.includes(source)) return [{ from: source, path: target }];
  return filesUnder(paths, source).map((from) => ({ from, path: target + from.slice(source.length) }));
}

/** What `key` does with the focus on `current` (null: nothing focused yet); null when nothing. */
export function navigate(rows: readonly Row[], current: string | null, key: string): Move | null {
  const index = rows.findIndex((row) => row.path === current);
  if (index < 0) return FOCUS_KEYS.has(key) && rows.length > 0 ? { focus: rows[0].path } : null;
  return Object.hasOwn(KEYS, key) ? KEYS[key](rows, index) : null;
}

const FOCUS_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

/** Focus on `target`, unless it is missing or already focused. */
function focusOn(rows: readonly Row[], index: number, target: number): Move | null {
  return target !== index && rows[target] ? { focus: rows[target].path } : null;
}

const KEYS: Record<string, (rows: readonly Row[], index: number) => Move | null> = {
  ArrowDown: (rows, i) => focusOn(rows, i, i + 1),
  ArrowUp: (rows, i) => focusOn(rows, i, i - 1),
  Home: (rows, i) => focusOn(rows, i, 0),
  End: (rows, i) => focusOn(rows, i, rows.length - 1),
  /** A closed folder opens; an open one hands the focus to its first child. */
  ArrowRight: (rows, i) => {
    const row = rows[i];
    if (row.kind !== 'folder') return null;
    if (!row.expanded) return { expand: row.path };
    return rows[i + 1]?.parent === row.path ? focusOn(rows, i, i + 1) : null;
  },
  /** An open folder closes; anything else hands the focus to its folder. */
  ArrowLeft: (rows, i) => {
    const row = rows[i];
    return row.expanded ? { collapse: row.path } : focusOn(rows, i, rows.findIndex((r) => r.path === row.parent));
  },
  Enter: (rows, i) => {
    const row = rows[i];
    if (row.kind === 'file') return { open: row.path };
    return row.expanded ? { collapse: row.path } : { expand: row.path };
  },
};

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function compare(a: TreeEntry, b: TreeEntry): number {
  return Number(b.kind === 'folder') - Number(a.kind === 'folder') || collator.compare(a.name, b.name);
}
