// FilePanel: the file panel's view — a "Files" header with its "New" menu, the project as a FileTree with a context
// menu per row, uploads. It turns gestures into FileChanges and leaves to its owner whether they happen. See ../files.ts.
import type { FileChange } from '../../../core/project/project';
import { type NamedPath, ProjectPath } from '../../../core/paths/paths';
import { uploadChanges } from '../../../core/uploads/uploads';
import type { FileDecoration, Window } from '../../../hosts/window/window';
import type { Memento, MenuContext, MenuItem } from '../../../hosts/workbench/workbench';
import { PopupMenu, type PopupMenuAnchor } from '../../../ui/popup-menu/popup-menu';
import { filesUnder, type Folder, folderOf, relocate } from '../model/tree-model';
import { icon } from './icons/icons';
import { FileTree } from './tree/tree';

/** The menus the panel shows (VS Code's ids): "New" in its header, and the context menu of a row. */
export const NEW_FILE_MENU = 'file/newFile';
export const CONTEXT_MENU = 'explorer/context';

/** What the panel asks the user with, and tells them: the window's input box and messages. */
export type FilePanelPrompts = Pick<Window, 'showInputBox' | 'showWarningMessage' | 'showErrorMessage'>;

export interface FilePanelOptions {
  /** Someone picked a file. */
  onOpen(path: ProjectPath): void;
  /** Someone asked for `change`. Resolves to why it was refused (an error message then), or null once applied. */
  onChange(change: FileChange): Promise<string | null>;
  prompts: FilePanelPrompts;
  /**
   * The entries of a menu the panel shows (`file/newFile`, `explorer/context`) in `context`, and how one runs: its
   * command with the row (or the focused row) as argument.
   */
  menus: { items(menuId: string, context: MenuContext): readonly MenuItem[]; run(command: string, resource: ProjectPath): void };
  /** Where the open folders are kept (key `openFolders`; default: only while the panel lives). */
  state?: Memento;
  /** The decorations of a file (badges, e.g. who else is in it), as they are at each `render` (default: none). */
  decorations?(path: ProjectPath): readonly FileDecoration[];
}

export interface FilePanelState {
  paths: ProjectPath[];
  main: ProjectPath;
  active: ProjectPath;
}

/**
 * The file panel: a "Files" header with "New" (the menu `file/newFile`), and the project as a `FileTree` whose rows
 * have a context menu (`explorer/context`: right click, Shift+F10, the context menu key). The operations behind the
 * entries (`newFile`, `newFolder`, `upload`, `rename`, `delete`) act on a row: a file, or a folder with everything in
 * it; new files and uploads go into the row's folder. The main file (and a folder holding it) stays where it is.
 * Names are asked for in the window's input box, refusals are error messages. It only turns gestures into
 * `FileChange`s; whether they happen is up to `onChange`.
 */
export class FilePanel {
  private readonly element: HTMLElement;
  private readonly tree: FileTree;
  private readonly newButton: HTMLButtonElement;
  private readonly picker: HTMLInputElement;
  private menu: PopupMenu | null = null;
  /** Folders made with "New folder" that hold no file yet. */
  private emptyFolders = new Set<ProjectPath>();
  /** Where the next upload goes. */
  private uploadFolder: Folder = null;

  constructor(
    parent: HTMLElement,
    private readonly options: FilePanelOptions,
    /** What the panel shows until the next `render`. */
    private state: FilePanelState,
  ) {
    const doc = parent.ownerDocument;
    this.element = element(doc, 'div', 'typst-files');
    this.element.dataset.testid = 'typst-files';
    const header = element(doc, 'div', 'typst-files__header');
    const title = element(doc, 'span', 'typst-files__title');
    title.textContent = 'Files';
    this.picker = doc.createElement('input');
    this.picker.type = 'file';
    this.picker.multiple = true;
    this.picker.hidden = true;
    this.picker.addEventListener('change', () => void this.uploadInto([...(this.picker.files ?? [])], this.uploadFolder));
    this.newButton = element(doc, 'button', 'typst-files__action');
    this.newButton.type = 'button';
    this.newButton.title = 'New';
    this.newButton.setAttribute('aria-label', 'New');
    this.newButton.setAttribute('aria-haspopup', 'menu');
    this.newButton.append(icon(doc, 'add'));
    this.newButton.addEventListener('click', () => this.showMenu(NEW_FILE_MENU, this.current(), this.newButton));
    header.append(title, this.newButton, this.picker);
    this.element.append(header);
    this.tree = new FileTree(this.element, {
      onOpen: (path) => options.onOpen(path),
      onRename: (path) => void this.rename(path),
      onDelete: (path) => void this.delete(path),
      onMove: (source, folder) => void this.move(source, folder),
      onUpload: (files, folder) => void this.uploadInto(files, folder),
      onContextMenu: (path, anchor) => this.showMenu(CONTEXT_MENU, path, anchor),
      state: options.state,
    });
    parent.append(this.element);
    this.render(state);
  }

  render(state: FilePanelState): void {
    this.state = state;
    for (const folder of this.emptyFolders) if (filesUnder(state.paths, folder).length > 0) this.emptyFolders.delete(folder);
    this.tree.render({ ...state, folders: [...this.emptyFolders], decorations: (path) => this.options.decorations?.(path) ?? [] });
    this.newButton.hidden = this.options.menus.items(NEW_FILE_MENU, this.context(this.current())).length === 0;
  }

  /** Asks for a name and creates that (empty) `.typ` file in the folder of `at` (default: the focused row), then opens it. */
  async newFile(at: ProjectPath = this.current()): Promise<void> {
    const name = await this.options.prompts.showInputBox({
      title: 'New file',
      prompt: 'Name of the new file',
      ...this.startIn(this.folderOf(at)),
      placeHolder: 'e.g. chapter-2',
      validateInput: (value) => this.problemWith(ProjectPath.fromName(value, '.typ')),
    });
    const target = name === undefined ? null : ProjectPath.fromName(name, '.typ');
    if (target?.kind === 'valid') await this.request([{ kind: 'create', path: target.path, content: '' }], target.path);
  }

  /** Asks for a name and makes that (empty) folder in the folder of `at`; it lives in the panel until a file goes in. */
  async newFolder(at: ProjectPath = this.current()): Promise<void> {
    const name = await this.options.prompts.showInputBox({
      title: 'New folder',
      prompt: 'Name of the new folder',
      ...this.startIn(this.folderOf(at)),
      placeHolder: 'e.g. chapters',
      validateInput: (value) => this.problemWith(ProjectPath.fromName(value, '')),
    });
    const target = name === undefined ? null : ProjectPath.fromName(name, '');
    if (!target || target.kind === 'invalid') return;
    this.emptyFolders.add(target.path);
    this.render(this.state);
    this.tree.focus(target.path);
  }

  /** Lets the user pick files from the computer, uploaded into the folder of `at`. */
  upload(at: ProjectPath = this.current()): void {
    this.uploadFolder = this.folderOf(at);
    this.picker.click();
  }

  /** Uploads `files` (e.g. dropped on the widget) to the top level; refusals are error messages. */
  uploadFiles(files: File[]): Promise<void> {
    return this.uploadInto(files, null);
  }

  /** Asks for the new name of a file, or a folder with its files (not the main file or a folder holding it). */
  async rename(from: ProjectPath = this.current()): Promise<void> {
    if (this.holdsMain(from)) return;
    const folder = this.tree.isFolder(from);
    const extension = folder ? '' : ProjectPath.extension(from);
    const shown = ProjectPath.displayName(from);
    const name = await this.options.prompts.showInputBox({
      title: `Rename ${shown}`,
      prompt: `Rename ${shown} to`,
      value: shown,
      // the name, without the folders and the extension (as VS Code)
      valueSelection: [shown.lastIndexOf('/') + 1, shown.length - extension.length],
      validateInput: (value) => this.problemWith(ProjectPath.fromName(value, extension), from),
    });
    const target = name === undefined ? null : ProjectPath.fromName(name, extension);
    if (!target || target.kind === 'invalid' || target.path === from) return;
    const error = await this.relocate(from, target.path);
    if (error) void this.options.prompts.showErrorMessage(error);
  }

  /** Deletes a file, or a folder with its files, once the user confirms (not the main file or a folder holding it). */
  async delete(path: ProjectPath = this.current()): Promise<void> {
    if (this.holdsMain(path)) return;
    const files = this.tree.isFolder(path) ? filesUnder(this.state.paths, path) : [path];
    const shown = ProjectPath.displayName(path);
    const what = files.length === 1 && files[0] === path ? shown : `${shown} and the ${files.length} files in it`;
    const confirmed = await this.options.prompts.showWarningMessage(`Delete ${what}? This cannot be undone.`, 'Delete');
    if (confirmed !== 'Delete') return;
    this.emptyFolders.delete(path);
    this.render(this.state);
    await this.request(files.map((file) => ({ kind: 'delete', path: file })), this.state.main);
  }

  dispose(): void {
    this.menu?.close();
    this.element.remove();
  }

  /** The focused row (a file or folder), else the shown file: what the panel's operations act on by default. */
  private current(): ProjectPath {
    return this.tree.current ?? this.state.active;
  }

  /** What a menu is shown for: the row `path` (`resource`), whether it is a folder, whether it holds the main file. */
  private context(path: ProjectPath): MenuContext {
    return { view: 'files', resource: path, resourceKind: this.tree.isFolder(path) ? 'folder' : 'file', resourceIsMain: this.holdsMain(path) };
  }

  /** The entries of `menuId` for the row `path`, as a popup menu at `anchor` (nothing while it has none). */
  private showMenu(menuId: string, path: ProjectPath, anchor: PopupMenuAnchor): void {
    this.menu?.close();
    const items = this.options.menus.items(menuId, this.context(path));
    if (items.length === 0) return;
    const label = menuId === NEW_FILE_MENU ? 'New' : ProjectPath.displayName(path);
    const entries = items.map((item) => ({ label: item.title ?? item.command, group: item.group, run: () => this.options.menus.run(item.command, path) }));
    this.menu = new PopupMenu(this.element, label, entries, anchor);
  }

  private holdsMain(path: ProjectPath): boolean {
    return path === this.state.main || this.state.main.startsWith(`${path}/`);
  }

  /** The folder a row stands for: itself, or the folder of a file. */
  private folderOf(path: ProjectPath): Folder {
    return this.tree.isFolder(path) ? path : folderOf(path);
  }

  /** An input box's start for a name in `folder`: 'chapters/', the caret after it ('' at the top level). */
  private startIn(folder: Folder): { value: string; valueSelection: [number, number] } {
    const value = folder === null ? '' : `${ProjectPath.displayName(folder)}/`;
    return { value, valueSelection: [value.length, value.length] };
  }

  /** What is wrong with a name typed for a new or renamed (from `from`) file or folder; null if nothing. */
  private problemWith(target: NamedPath, from?: ProjectPath): string | null {
    if (target.kind === 'invalid') return target.error;
    if (target.path === from) return null;
    const taken = this.state.paths.includes(target.path) || this.tree.isFolder(target.path);
    return taken ? `${ProjectPath.displayName(target.path)} already exists.` : null;
  }

  /** A row dragged onto `folder`. */
  private async move(source: ProjectPath, folder: Folder): Promise<void> {
    const target = ProjectPath.of(`${folder ?? ''}/${source.slice(source.lastIndexOf('/') + 1)}`);
    const error = await this.relocate(source, target);
    if (error) void this.options.prompts.showErrorMessage(error);
  }

  /** Moves a file, or a folder with its files, to `target`; opens the moved file. */
  private async relocate(source: ProjectPath, target: ProjectPath): Promise<string | null> {
    if (this.holdsMain(source)) return 'The main file stays where it is.';
    const renames = relocate(this.state.paths, source, target);
    if (this.emptyFolders.delete(source)) this.emptyFolders.add(target);
    const open = renames.find((r) => r.from === this.state.active)?.path ?? (renames.length === 1 ? renames[0].path : this.state.active);
    const error = await this.request(renames.map((r) => ({ kind: 'rename', ...r })), open, false);
    if (!error && renames.length !== 1) this.tree.focus(target);
    return error;
  }

  private async uploadInto(files: File[], folder: Folder): Promise<void> {
    this.picker.value = '';
    const changes = (await uploadChanges(files)).map((change) => ({ ...change, path: ProjectPath.of(`${folder ?? ''}${change.path}`) }));
    await this.request(changes, changes[changes.length - 1]?.path ?? null);
  }

  /**
   * Asks for `changes` one after the other (stopping at a refusal, told as an error message unless `tell` is false),
   * then opens `open` if all were applied. Resolves to the refusal, or null.
   */
  private async request(changes: FileChange[], open: ProjectPath | null, tell = true): Promise<string | null> {
    for (const change of changes) {
      const error = await this.options.onChange(change);
      if (!error) continue;
      if (tell) void this.options.prompts.showErrorMessage(error);
      return error;
    }
    if (open !== null && changes.length > 0) this.options.onOpen(open);
    this.render(this.state);
    return null;
  }
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  return node;
}
