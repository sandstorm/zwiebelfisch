// FileTree: the project's files as an expandable tree (keyboard, drag & drop, presence dots). Entry of
// features/files/tree/. See files.ts and ARCHITECTURE.md, "File panel".
import { PROJECT_PATH_TYPE } from '../../../core/project/project';
import { displayName, fileKind } from '../../../core/paths/paths';
import { initials, presenceStyle, type PresenceUser } from '../../../core/typst-document/typst-document';
import { icon } from '../icons';
import { ancestorsOf, buildTree, filesUnder, folderOf, navigate, type Row, visibleRows } from './tree-model';

export { filesUnder, relocate } from './tree-model';

/** Where the tree remembers its open folders (e.g. for the browser session). */
export interface FolderMemory {
  load(): string[] | null;
  save(folders: string[]): void;
}

export interface FileTreeOptions {
  /** A file was chosen (click, Enter). */
  onOpen(path: string): void;
  /** F2 on a row (a file or a folder). */
  onRename(path: string): void;
  /** Delete on a row (a file or a folder). */
  onDelete(path: string): void;
  /** A row (file or folder) was dragged onto `folder` ('' for the top level). */
  onMove(source: string, folder: string): void;
  /** Files from the computer were dropped onto `folder`. */
  onUpload(files: File[], folder: string): void;
  memory?: FolderMemory;
}

export interface TreeState {
  paths: readonly string[];
  /** Empty folders that exist only in the panel so far. */
  folders: readonly string[];
  main: string;
  active: string;
  /** Who else is in which file. */
  presence: ReadonlyMap<string, readonly PresenceUser[]>;
}

/** The type of a dragged tree row in a drag's data. */
const ROW_TYPE = PROJECT_PATH_TYPE;

/**
 * The project's files as a tree (`role=tree`, one `treeitem` per visible row):
 * folders first, expandable (open folders are remembered), the main file
 * marked, the shown file selected, who else is where as dots. One row has
 * the focus ("current": where new files go, what F2 and Delete act on).
 * Keyboard: arrows, Home/End, Enter, F2, Delete. Rows can be dragged onto
 * folders, and files from the computer dropped onto them.
 */
export class FileTree {
  readonly element: HTMLElement;
  private readonly expanded: Set<string>;
  private state: TreeState = { paths: [], folders: [], main: '', active: '', presence: new Map() };
  private rows: Row[] = [];
  private currentPath: string | null = null;

  constructor(parent: HTMLElement, private readonly options: FileTreeOptions) {
    this.element = parent.ownerDocument.createElement('div');
    this.element.className = 'typst-files__tree';
    this.element.setAttribute('role', 'tree');
    this.element.setAttribute('aria-label', 'Files');
    this.expanded = new Set(options.memory?.load() ?? []);
    this.element.addEventListener('click', (event) => this.click(event));
    this.element.addEventListener('keydown', (event) => this.key(event));
    this.listenToDrags();
    parent.append(this.element);
  }

  /** The focused row (a file or folder path), else the shown file. */
  get current(): string {
    return this.currentPath ?? this.state.active;
  }

  /** The folder new files go into: the current folder, or the folder of the current file. */
  get folder(): string {
    const current = this.current;
    return this.isFolder(current) ? current : folderOf(current);
  }

  isFolder(path: string): boolean {
    return path !== '' && !this.state.paths.includes(path) && (this.state.folders.includes(path) || filesUnder(this.state.paths, path).length > 0);
  }

  render(state: TreeState): void {
    const shown = state.active !== this.state.active;
    this.state = state;
    if (shown) {
      this.currentPath = state.active;
      for (const folder of ancestorsOf(state.active)) this.expanded.add(folder);
    }
    if (this.currentPath !== null && !state.paths.includes(this.currentPath) && !this.isFolder(this.currentPath)) this.currentPath = null;
    this.draw();
  }

  /** Focuses the row of `path` (e.g. a new folder), opening the folders around it. */
  focus(path: string): void {
    for (const folder of ancestorsOf(path)) this.expanded.add(folder);
    this.currentPath = path;
    this.draw();
    this.rowElement(path)?.focus();
  }

  /** Opens or closes `folder`. */
  setExpanded(folder: string, open: boolean): void {
    if (open) this.expanded.add(folder);
    else this.expanded.delete(folder);
    this.options.memory?.save([...this.expanded]);
    this.draw();
  }

  private draw(): void {
    // The root's active element: inside <typst-editor>'s shadow root the document only sees the host.
    const hadFocus = this.element.contains((this.element.getRootNode() as Document | ShadowRoot).activeElement);
    const { paths, folders } = this.state;
    this.rows = visibleRows(buildTree(paths, folders), this.expanded);
    const tabbable = this.rows.some((row) => row.path === this.current) ? this.current : this.rows[0]?.path;
    this.element.replaceChildren(...this.rows.map((row) => this.rowElementFor(row, row.path === tabbable)));
    if (hadFocus) this.rowElement(tabbable ?? '')?.focus();
  }

  private rowElementFor(row: Row, tabbable: boolean): HTMLElement {
    const doc = this.element.ownerDocument;
    const item = element(doc, 'div', `typst-files__row typst-files__row--${row.kind}`);
    item.setAttribute('role', 'treeitem');
    item.setAttribute('aria-level', String(row.depth + 1));
    item.tabIndex = tabbable ? 0 : -1;
    item.dataset.path = row.path;
    item.title = displayName(row.path);
    item.draggable = true;
    item.style.setProperty('--typst-files-depth', String(row.depth));
    const name = element(doc, 'span', 'typst-files__name');
    name.textContent = row.name;
    if (row.kind === 'folder') {
      item.setAttribute('aria-expanded', String(row.expanded));
      item.append(chevron(doc), icon(doc, row.expanded ? 'folder-open' : 'folder'), name);
    } else {
      item.setAttribute('aria-selected', String(row.path === this.state.active));
      item.append(icon(doc, fileKind(row.path)), name);
    }
    if (row.path === this.state.main) item.append(badge(doc));
    const users = this.usersIn(row);
    if (users.length > 0) item.append(presenceDots(doc, users));
    return item;
  }

  /** The others in a file, or in any file of a closed folder. */
  private usersIn(row: Row): PresenceUser[] {
    const { presence, paths } = this.state;
    if (row.kind === 'file') return [...(presence.get(row.path) ?? [])];
    if (row.expanded) return [];
    const users = filesUnder(paths, row.path).flatMap((path) => presence.get(path) ?? []);
    return [...new Map(users.map((user) => [user.name, user])).values()];
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
    const handled = this.command(event.key) || this.move(navigate(this.rows, this.current, event.key));
    if (handled) event.preventDefault();
  }

  private command(key: string): boolean {
    if (key === 'F2') this.options.onRename(this.current);
    else if (key === 'Delete') this.options.onDelete(this.current);
    else return false;
    return true;
  }

  private move(move: ReturnType<typeof navigate>): boolean {
    if (!move) return false;
    if ('focus' in move) this.focus(move.focus);
    if ('expand' in move) this.setExpanded(move.expand, true);
    if ('collapse' in move) this.setExpanded(move.collapse, false);
    if ('open' in move) this.options.onOpen(move.open);
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
    const folderAt = (event: DragEvent): string => {
      const path = (event.target as HTMLElement).closest<HTMLElement>('[data-path]')?.dataset.path ?? '';
      return this.isFolder(path) ? path : folderOf(path);
    };
    const types = (event: DragEvent) => event.dataTransfer?.types ?? [];
    const accepts = (event: DragEvent) => types(event).includes(ROW_TYPE) || types(event).includes('Files');
    this.element.addEventListener('dragstart', (event) => {
      const path = (event.target as HTMLElement).closest<HTMLElement>('[data-path]')?.dataset.path;
      if (!path || !event.dataTransfer) return;
      event.dataTransfer.setData(ROW_TYPE, path);
      // moved onto a folder here; copied as a reference elsewhere (an image dropped into the text)
      event.dataTransfer.effectAllowed = 'copyMove';
    });
    this.element.addEventListener('dragover', (event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      mark(this.rowElement(folderAt(event)));
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
      const source = event.dataTransfer?.getData(ROW_TYPE);
      if (source) this.options.onMove(source, folder);
      else this.options.onUpload([...(event.dataTransfer?.files ?? [])], folder);
    });
  }
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

/** One dot per user: initials on their color, the name as tooltip. */
function presenceDots(doc: Document, users: readonly PresenceUser[]): HTMLElement {
  const dots = element(doc, 'span', 'typst-files__presence');
  dots.setAttribute('aria-label', `Here: ${users.map((user) => user.name).join(', ')}`);
  for (const user of users) {
    const dot = element(doc, 'span', 'typst-files__user');
    dot.textContent = initials(user.name);
    dot.title = user.name;
    dot.dataset.user = user.name;
    presenceStyle(dot, user);
    dots.append(dot);
  }
  return dots;
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string) {
  const node = doc.createElement(tag);
  node.className = className;
  return node;
}
