// The file panel's view. See files in ../files.ts.
import type { FileChange } from '../../../core/project/project';
import { type NamedPath, ProjectPath } from '../../../core/paths/paths';
import { uploadChanges } from '../../../core/uploads/uploads';
import type { FileDecoration, MenuAnchor, WindowApi } from '../../../hosts/window/window';
import type { MenuContext } from '../../../hosts/commands/commands';
import type { Memento } from '../../../hosts/extension-host/extension-host';
import { filesUnder, type Folder, folderOf, relocate } from '../model/tree-model';
import { icon } from './icons/icons';
import { FileTree } from './tree/tree';

/**
 * The file panel: a "Files" header with "New" (the menu `files/new`), and the project as a `FileTree` whose rows
 * have a context menu (`files/row`: right click, Shift+F10, the context menu key). The operations behind the
 * entries (`newFile`, `newFolder`, `upload`, `rename`, `delete`) act on a row: a file, or a folder with everything in
 * it; new files and uploads go into the row's folder, unless it is read-only. A row stays where it is (no rename,
 * move or delete) when it holds the main file or a read-only folder keeps it: the folder it is in, or a folder row's own.
 * Names are asked for in the window's input box, refusals are error messages. It only turns gestures into
 * `FileChange`s; whether they happen is up to `onChange`.
 */
export class FilePanel {
  private readonly element: HTMLElement;
  private readonly tree: FileTree;
  private readonly newButton: HTMLButtonElement;
  private readonly picker: HTMLInputElement;
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
    this.element = element(doc, 'div', 'zwf-files');
    this.element.dataset.testid = 'zwf-files';
    const header = element(doc, 'div', 'zwf-files__header');
    const title = element(doc, 'span', 'zwf-files__title');
    title.textContent = 'Files';
    this.picker = doc.createElement('input');
    this.picker.type = 'file';
    this.picker.multiple = true;
    this.picker.hidden = true;
    this.picker.addEventListener('change', () => void this.uploadInto([...(this.picker.files ?? [])], this.uploadFolder));
    this.newButton = element(doc, 'button', 'zwf-files__action');
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
    this.tree.render({
      ...state,
      folders: [...this.emptyFolders],
      decorations: (path) => this.options.decorations?.(path) ?? [],
      icon: (path) => this.options.icon?.(path),
    });
    this.newButton.hidden = !this.options.hasMenuItems(NEW_FILE_MENU, this.context(this.current()));
  }

  /**
   * Asks for a name (`showSaveDialog`: `.typ` added to a name without an ending) and creates that empty file in the
   * folder of `at` (default: the focused row), then opens it.
   */
  async newFile(at: ProjectPath = this.current()): Promise<void> {
    const folder = this.folderOf(at);
    const target = await this.options.prompts.showSaveDialog({ title: 'New file', defaultUri: folder ?? undefined, filters: NEW_FILE_ENDINGS });
    if (target) await this.request([{ kind: 'create', path: target, content: '' }], target);
  }

  /** Asks for a name and makes that (empty) folder in the folder of `at`; it lives in the panel until a file goes in. */
  async newFolder(at: ProjectPath = this.current()): Promise<void> {
    const name = await this.options.prompts.showInputBox({
      title: 'New folder',
      prompt: 'Name of the new folder',
      ...this.startIn(this.folderOf(at)),
      placeHolder: 'e.g. chapters',
      validateInput: (value) => {
        const target = ProjectPath.fromName(value, '');
        return target.kind === 'valid' && this.readonly(folderOf(target.path)) ? 'New folders go into the project folder.' : this.problemWith(target);
      },
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

  /** Asks for the new name of a file, or a folder with its files (not a row that stays where it is). */
  async rename(from: ProjectPath = this.current()): Promise<void> {
    if (this.fixed(from)) return;
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

  /** Deletes a file, or a folder with its files, once the user confirms (not a row that stays where it is). */
  async delete(path: ProjectPath = this.current()): Promise<void> {
    if (this.fixed(path)) return;
    const files = this.tree.isFolder(path) ? filesUnder(this.state.paths, path) : [path];
    const shown = ProjectPath.displayName(path);
    const what = files.length === 1 && files[0] === path ? shown : `${shown} and the ${files.length} files in it`;
    if (!(await this.confirm(path, `Delete ${what}? This cannot be undone.`, 'Delete', true))) return;
    this.emptyFolders.delete(path);
    this.render(this.state);
    await this.request(files.map((file) => ({ kind: 'delete', path: file })), this.state.main);
  }

  dispose(): void {
    this.element.remove();
  }

  /** The focused row (a file or folder), else the shown file: what the panel's operations act on by default. */
  private current(): ProjectPath {
    return this.tree.current ?? this.state.active;
  }

  /**
   * What a menu is shown for: the row `path` (`resource`), whether it is a folder, whether it holds the main file,
   * whether it stays where it is (`resourceIsFixed`), whether its folder (where new files go) is read-only.
   */
  private context(path: ProjectPath): MenuContext {
    return {
      view: 'files',
      resource: path,
      resourceKind: this.tree.isFolder(path) ? 'folder' : 'file',
      resourceIsMain: this.holdsMain(path),
      resourceIsFixed: this.fixed(path),
      folderIsReadonly: this.readonly(this.folderOf(path)),
    };
  }

  /** The menu `menuId` for the row `path` at `anchor` (the window's); its entries' commands get the row. */
  private showMenu(menuId: string, path: ProjectPath, anchor: MenuAnchor): void {
    const title = menuId === NEW_FILE_MENU ? 'New' : ProjectPath.displayName(path);
    this.options.prompts.showContextMenu(menuId, { anchor, title, context: this.context(path), args: [path] });
  }

  private holdsMain(path: ProjectPath): boolean {
    return path === this.state.main || this.state.main.startsWith(`${path}/`);
  }

  /** Whether the row `path` stays where it is: it holds the main file, it is read-only, or the folder it is in is. */
  private fixed(path: ProjectPath): boolean {
    return this.holdsMain(path) || this.readonly(folderOf(path)) || this.readonly(path);
  }

  /**
   * Whether the user confirms `question` (with `button`) for the row `path`, after the warnings of its files
   * (`options.warning`, each once); without warnings asked only if `always`.
   */
  private async confirm(path: ProjectPath, question: string, button: string, always = false): Promise<boolean> {
    const files = this.tree.isFolder(path) ? filesUnder(this.state.paths, path) : [path];
    const warnings = [...new Set(files.flatMap((file) => this.options.warning?.(file) ?? []))];
    if (warnings.length === 0 && !always) return true;
    return (await this.options.prompts.showWarningMessage([...warnings, question].join(' '), { modal: true }, button)) === button;
  }

  private readonly(path: Folder): boolean {
    return this.options.readonly?.(path) ?? false;
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
    const target = ProjectPath.of(`${folder ?? ''}/${ProjectPath.name(source)}`);
    const error = await this.relocate(source, target);
    if (error) void this.options.prompts.showErrorMessage(error);
  }

  /** Moves a file, or a folder with its files, to `target` (once the user confirms the warnings, if any); opens the moved file. */
  private async relocate(source: ProjectPath, target: ProjectPath): Promise<string | null> {
    if (this.holdsMain(source)) return 'The main file stays where it is.';
    if (this.fixed(source)) return `${ProjectPath.displayName(source)} stays where it is.`;
    if (!(await this.confirm(source, `Move ${ProjectPath.displayName(source)} to ${ProjectPath.displayName(target)}?`, 'Move'))) return null;
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

/** The menus the panel shows (VS Code's ids): "New" in its header, and the context menu of a row. */
export const NEW_FILE_MENU = 'files/new';
export const CONTEXT_MENU = 'files/row';

/** What the panel asks the user with, and tells them: the window's input box, save dialog, menus and messages. */
export type FilePanelPrompts = Pick<WindowApi, 'showInputBox' | 'showSaveDialog' | 'showContextMenu' | 'showWarningMessage' | 'showErrorMessage'>;

export interface FilePanelOptions {
  /** Someone picked a file. */
  onOpen(path: ProjectPath): void;
  /** Someone asked for `change`. Resolves to why it was refused (an error message then), or null once applied. */
  onChange(change: FileChange): Promise<string | null>;
  prompts: FilePanelPrompts;
  /** Whether a menu the panel shows (`files/new`) has entries in `context` ("New" is hidden while it has none). */
  hasMenuItems(menuId: string, context: MenuContext): boolean;
  /** Where the open folders are kept (key `openFolders`; default: only while the panel lives). */
  state?: Memento;
  /** The decorations of a file (badges, e.g. who else is in it), as they are at each `render` (default: none). */
  decorations?(path: ProjectPath): readonly FileDecoration[];
  /** The icon of a file that is no Typst file, SVG markup (`window.getFileIcon`; default: the same for every file). */
  icon?(path: ProjectPath): string | undefined;
  /**
   * Whether the folder `path` (null: the top level) holds no file that may be created, renamed or deleted, or the file
   * `path` may not be changed, renamed or deleted, at each `render` (default: none is).
   */
  readonly?(path: Folder): boolean;
  /** Why to think twice before the file `path` is renamed, moved or deleted (asked first; default: none). */
  warning?(path: ProjectPath): string | undefined;
}

export interface FilePanelState {
  paths: ProjectPath[];
  main: ProjectPath;
  active: ProjectPath;
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  node.className = className;
  return node;
}

/** "New file": a Typst file unless the name has another ending. */
const NEW_FILE_ENDINGS = { Typst: ['typ'], 'All files': ['*'] };
