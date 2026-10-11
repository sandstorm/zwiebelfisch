// FileTree: the project's files as an expandable tree (keyboard, drag & drop, decorations). See ../file-panel.ts and ARCHITECTURE.md, "File panel".
import { ProjectPath } from '../../../../core/paths/paths';
import { type Memento, PROJECT_PATH_TYPE } from '../../../../hosts/workbench/workbench';
import type { FileDecoration } from '../../../../hosts/window/window';
import { textColorOn } from '../../../../core/color-scheme/color-scheme';
import { fileIcon, icon } from '../icons/icons';
import { ancestorsOf, buildTree, filesUnder, type Folder, folderOf, type Move, navigate, type Row, visibleRows } from '../../model/tree-model';

export interface FileTreeOptions {
  /** A file was chosen (click, Enter). */
  onOpen(path: ProjectPath): void;
  /** F2 on a row (a file or a folder). */
  onRename(path: ProjectPath): void;
  /** Delete on a row (a file or a folder). */
  onDelete(path: ProjectPath): void;
  /** A row (file or folder) was dragged onto `folder` (null: the top level). */
  onMove(source: ProjectPath, folder: Folder): void;
  /** Files from the computer were dropped onto `folder`. */
  onUpload(files: File[], folder: Folder): void;
  /** The context menu of a row was asked for: a right click (at its point), Shift+F10 or the context menu key (below the row). */
  onContextMenu(path: ProjectPath, anchor: { x: number; y: number } | HTMLElement): void;
  /** Where the open folders are kept (key `openFolders`), e.g. the workspace state. */
  state?: Memento;
}

export interface TreeState {
  paths: readonly ProjectPath[];
  /** Empty folders that exist only in the panel so far. */
  folders: readonly ProjectPath[];
  main: ProjectPath;
  active: ProjectPath;
  /** The decorations of a file (badges such as who else is in it). */
  decorations(path: ProjectPath): readonly FileDecoration[];
}

/**
 * The project's files as a tree (`role=tree`, one `treeitem` per visible row):
 * folders first, expandable (open folders are remembered), the main file
 * marked, the shown file selected, the files' decorations as badges. One row has
 * the focus ("current": where new files go, what F2 and Delete act on).
 * Keyboard: arrows, Home/End, Enter, F2, Delete, Shift+F10 / the context menu
 * key (its context menu; also a right click). Rows can be dragged onto
 * folders, and files from the computer dropped onto them.
 */
export class FileTree {
  private readonly element: HTMLElement;
  private readonly expanded: Set<ProjectPath>;
  private state: TreeState | null = null;
  private rows: Row[] = [];
  private currentPath: ProjectPath | null = null;

  constructor(parent: HTMLElement, private readonly options: FileTreeOptions) {
    this.element = parent.ownerDocument.createElement('div');
    this.element.className = 'typst-files__tree';
    this.element.setAttribute('role', 'tree');
    this.element.setAttribute('aria-label', 'Files');
    this.expanded = new Set(openFolders(options.state?.get<unknown>(OPEN_FOLDERS)));
    this.element.addEventListener('click', (event) => this.click(event));
    this.element.addEventListener('keydown', (event) => this.key(event));
    this.element.addEventListener('contextmenu', (event) => this.contextMenu(event));
    this.listenToDrags();
    parent.append(this.element);
  }

  /** The focused row (a file or folder path), else the shown file; null before the first `render`. */
  get current(): ProjectPath | null {
    return this.currentPath ?? this.state?.active ?? null;
  }

  isFolder(path: ProjectPath): boolean {
    const state = this.state;
    return !!state && !state.paths.includes(path) && (state.folders.includes(path) || filesUnder(state.paths, path).length > 0);
  }

  render(state: TreeState): void {
    const shown = state.active !== this.state?.active;
    this.state = state;
    if (shown) {
      this.currentPath = state.active;
      for (const folder of ancestorsOf(state.active)) this.expanded.add(folder);
    }
    if (this.currentPath !== null && !state.paths.includes(this.currentPath) && !this.isFolder(this.currentPath)) this.currentPath = null;
    this.draw();
  }

  /** Focuses the row of `path` (e.g. a new folder), opening the folders around it. */
  focus(path: ProjectPath): void {
    for (const folder of ancestorsOf(path)) this.expanded.add(folder);
    this.currentPath = path;
    this.draw();
    this.rowElement(path)?.focus();
  }

  /** Opens or closes `folder`. */
  private setExpanded(folder: ProjectPath, open: boolean): void {
    if (open) this.expanded.add(folder);
    else this.expanded.delete(folder);
    void this.options.state?.update(OPEN_FOLDERS, [...this.expanded]);
    this.draw();
  }

  private draw(): void {
    // The root's active element: inside <typst-editor>'s shadow root the document only sees the host.
    const hadFocus = this.element.contains((this.element.getRootNode() as Document | ShadowRoot).activeElement);
    const state = this.state;
    if (!state) return;
    this.rows = visibleRows(buildTree(state.paths, state.folders), this.expanded);
    const tabbable = this.rows.some((row) => row.path === this.current) ? this.current : (this.rows[0]?.path ?? null);
    this.element.replaceChildren(...this.rows.map((row) => this.rowElementFor(state, row, row.path === tabbable)));
    if (hadFocus && tabbable) this.rowElement(tabbable)?.focus();
  }

  private rowElementFor(state: TreeState, row: Row, tabbable: boolean): HTMLElement {
    const doc = this.element.ownerDocument;
    const item = element(doc, 'div', `typst-files__row typst-files__row--${row.kind}`);
    item.setAttribute('role', 'treeitem');
    item.setAttribute('aria-level', String(row.depth + 1));
    item.tabIndex = tabbable ? 0 : -1;
    item.dataset.path = row.path;
    item.title = ProjectPath.displayName(row.path);
    item.draggable = true;
    item.style.setProperty('--typst-files-depth', String(row.depth));
    const name = element(doc, 'span', 'typst-files__name');
    name.textContent = row.name;
    if (row.kind === 'folder') {
      item.setAttribute('aria-expanded', String(row.expanded));
      item.append(chevron(doc), icon(doc, row.expanded ? 'folder-open' : 'folder'), name);
    } else {
      item.setAttribute('aria-selected', String(row.path === state.active));
      item.append(icon(doc, fileIcon(row.path)), name);
    }
    if (row.path === state.main) item.append(badge(doc));
    const decorations = decorationsOf(state, row);
    if (decorations.length > 0) item.append(badges(doc, decorations));
    return item;
  }

  private click(event: MouseEvent): void {
    const path = (event.target as HTMLElement).closest<HTMLElement>('[data-path]')?.dataset.path;
    const row = this.rows.find((r) => r.path === path);
    if (!row) return;
    this.currentPath = row.path;
    if (row.kind === 'folder') this.setExpanded(row.path, !row.expanded);
    else this.options.onOpen(row.path);
    this.rowElement(row.path)?.focus();
  }

  private key(event: KeyboardEvent): void {
    if (!(event.target as HTMLElement).closest('[role=treeitem]')) return;
    const handled = this.command(event) || this.move(navigate(this.rows, this.current, event.key));
    if (handled) event.preventDefault();
  }

  private command(event: KeyboardEvent): boolean {
    const current = this.current;
    if (current === null) return false;
    if (event.key === 'F2') this.options.onRename(current);
    else if (event.key === 'Delete') this.options.onDelete(current);
    else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) this.options.onContextMenu(current, this.rowElement(current) ?? this.element);
    else return false;
    return true;
  }

  /** A right click on a row: it becomes the focused row, and its context menu opens at the click. */
  private contextMenu(event: MouseEvent): void {
    const path = ProjectPath.parse((event.target as HTMLElement).closest<HTMLElement>('[data-path]')?.dataset.path ?? '');
    if (path === null) return;
    event.preventDefault();
    this.currentPath = path;
    this.draw();
    this.rowElement(path)?.focus();
    this.options.onContextMenu(path, { x: event.clientX, y: event.clientY });
  }

  private move(move: Move | null): boolean {
    if (!move) return false;
    if (move.kind === 'focus') this.focus(move.path);
    else if (move.kind === 'open') this.options.onOpen(move.path);
    else this.setExpanded(move.path, move.kind === 'expand');
    return true;
  }

  private rowElement(path: string): HTMLElement | null {
    return [...this.element.querySelectorAll<HTMLElement>('[role=treeitem]')].find((item) => item.dataset.path === path) ?? null;
  }

  /** Rows dragged onto folders move there; files from the computer are uploaded into the folder. */
  private listenToDrags(): void {
    let target: HTMLElement | null = null;
    const mark = (next: HTMLElement | null) => {
      target?.classList.remove('typst-files__row--drop');
      target = next;
      target?.classList.add('typst-files__row--drop');
    };
    const pathAt = (event: DragEvent): ProjectPath | null =>
      ProjectPath.parse((event.target as HTMLElement).closest<HTMLElement>('[data-path]')?.dataset.path ?? '');
    const folderAt = (event: DragEvent): Folder => {
      const path = pathAt(event);
      return path === null || this.isFolder(path) ? path : folderOf(path);
    };
    const types = (event: DragEvent) => event.dataTransfer?.types ?? [];
    const accepts = (event: DragEvent) => types(event).includes(PROJECT_PATH_TYPE) || types(event).includes('Files');
    this.element.addEventListener('dragstart', (event) => {
      const path = pathAt(event);
      if (!path || !event.dataTransfer) return;
      event.dataTransfer.setData(PROJECT_PATH_TYPE, path);
      // moved onto a folder here; copied as a reference elsewhere (an image dropped into the text)
      event.dataTransfer.effectAllowed = 'copyMove';
    });
    this.element.addEventListener('dragover', (event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      const folder = folderAt(event);
      mark(folder === null ? null : this.rowElement(folder));
    });
    this.element.addEventListener('dragleave', (event) => {
      if (!this.element.contains(event.relatedTarget as Node | null)) mark(null);
    });
    this.element.addEventListener('drop', (event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      // Not uploaded once more by the widget's drop handler.
      event.stopPropagation();
      mark(null);
      const folder = folderAt(event);
      const source = ProjectPath.parse(event.dataTransfer?.getData(PROJECT_PATH_TYPE) ?? '');
      if (source) this.options.onMove(source, folder);
      else this.options.onUpload([...(event.dataTransfer?.files ?? [])], folder);
    });
  }
}

/** The decorations of a file, or those of the files in a closed folder that propagate (each once). */
function decorationsOf({ decorations, paths }: TreeState, row: Row): FileDecoration[] {
  if (row.kind === 'file') return [...decorations(row.path)];
  if (row.expanded) return [];
  const inside = filesUnder(paths, row.path).flatMap((path) => decorations(path).filter((decoration) => decoration.propagate));
  return [...new Map(inside.map((decoration) => [JSON.stringify([decoration.badge, decoration.tooltip, decoration.color]), decoration])).values()];
}

function chevron(doc: Document): SVGSVGElement {
  const svg = icon(doc, 'chevron');
  svg.classList.add('typst-files__chevron');
  return svg;
}

function badge(doc: Document): HTMLElement {
  const main = element(doc, 'span', 'typst-files__badge');
  main.textContent = 'Main';
  return main;
}

/** One badge per decoration, in its color, its tooltip as title; the row names them all. */
function badges(doc: Document, decorations: readonly FileDecoration[]): HTMLElement {
  const badges = element(doc, 'span', 'typst-files__decorations');
  badges.setAttribute('aria-label', decorations.flatMap((decoration) => decoration.tooltip ?? []).join(', '));
  for (const { badge, tooltip, color } of decorations) {
    const dot = element(doc, 'span', 'typst-files__decoration');
    dot.textContent = badge ?? '';
    if (tooltip) dot.title = tooltip;
    if (color) {
      dot.style.setProperty('--typst-files-decoration-color', color);
      dot.style.setProperty('--typst-files-decoration-text', textColorOn(color));
    }
    badges.append(dot);
  }
  return badges;
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string) {
  const node = doc.createElement(tag);
  node.className = className;
  return node;
}

/** Where the tree keeps its open folders. */
const OPEN_FOLDERS = 'openFolders';

/** The open folders kept, read as data from storage: only project paths count. */
function openFolders(kept: unknown): ProjectPath[] {
  return Array.isArray(kept) ? kept.flatMap((folder) => (typeof folder === 'string' ? (ProjectPath.parse(folder) ?? []) : [])) : [];
}
