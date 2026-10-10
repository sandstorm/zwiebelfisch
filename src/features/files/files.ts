// FilePanel: the project's files as a tree in the left side panel (new file / folder, upload, rename,
// delete, drag & drop, presence). Entry of features/files/. See ARCHITECTURE.md, "File panel".
import type { PlacedPresence, PresenceUser } from '../../core/typst-document/typst-document';
import { type FileChange } from '../../core/project/project';
import { displayName, extensionOf, toPath } from '../../core/paths/paths';
import { icon, type IconName } from './icons';
import { FileTree, filesUnder, type FolderMemory, relocate } from './tree/tree';
import { uploadChanges } from './upload';

export { AssetView } from './asset-view';
export { uploadChanges } from './upload';
export type { FolderMemory } from './tree/tree';

/** The file panel's icon (e.g. for the button that opens it). */
export function filesPanelIcon(doc: Document): SVGSVGElement {
  return icon(doc, 'files');
}

export interface FilePanelOptions {
  /** Someone picked a file. */
  onOpen(path: string): void;
  /** Someone asked for `change`. Resolves to why it was refused (shown to them), or null once applied. */
  onChange(change: FileChange): Promise<string | null>;
  /** Where the open folders are remembered (default: only while the panel lives). */
  memory?: FolderMemory;
}

export interface FileListState {
  paths: string[];
  main: string;
  active: string;
}

interface Prompt {
  message: string;
  /** Initial text of the name field; without it the prompt is a plain confirmation. */
  value?: string;
  confirm: string;
  danger?: boolean;
  submit(value: string): Promise<string | null>;
}

/**
 * The file panel: a "Files" header with New file, New folder, Upload, Rename
 * and Delete, and the project as a `FileTree`. Names are asked for inline,
 * refused changes show why. Rename and Delete act on the focused row (a file,
 * or a folder with everything in it); the main file (and a folder holding it)
 * stays. New files and uploads go into the focused folder. Files dropped on
 * `dropTarget` are uploaded while `acceptDrops`. It only turns gestures into
 * `FileChange`s; whether they happen is up to `onChange`.
 */
export class FilePanel {
  readonly element: HTMLElement;
  private readonly tree: FileTree;
  private readonly rename: HTMLButtonElement;
  private readonly remove: HTMLButtonElement;
  private readonly picker: HTMLInputElement;
  private prompt: HTMLFormElement | null = null;
  private state: FileListState = { paths: [], main: '', active: '' };
  /** Who else is in which file. */
  private others = new Map<string, PresenceUser[]>();
  /** Folders made with "New folder" that hold no file yet. */
  private emptyFolders = new Set<string>();
  /** Where the next upload goes. */
  private uploadFolder = '';
  private readonly detachDrop: () => void;
  /** Whether files dropped anywhere on `dropTarget` are uploaded (else ignored). */
  acceptDrops = true;

  constructor(
    parent: HTMLElement,
    dropTarget: HTMLElement,
    private readonly options: FilePanelOptions,
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
    this.picker.addEventListener('change', () => void this.upload([...(this.picker.files ?? [])], this.uploadFolder));
    const actions = element(doc, 'div', 'typst-files__actions');
    actions.append(
      iconButton(doc, 'add', 'New file', () => this.askCreate()),
      iconButton(doc, 'add-folder', 'New folder', () => this.askFolder()),
      iconButton(doc, 'upload', 'Upload', () => this.pick()),
      (this.rename = iconButton(doc, 'rename', 'Rename', () => this.askRename(this.tree.current))),
      (this.remove = iconButton(doc, 'delete', 'Delete', () => this.askDelete(this.tree.current))),
    );
    header.append(title, actions, this.picker);
    this.element.append(header);
    this.tree = new FileTree(this.element, {
      onOpen: (path) => options.onOpen(path),
      onRename: (path) => this.askRename(path),
      onDelete: (path) => this.askDelete(path),
      onMove: (source, folder) => void this.move(source, folder),
      onUpload: (files, folder) => void this.upload(files, folder),
      memory: options.memory,
    });
    this.tree.element.addEventListener('focusin', () => this.updateButtons());
    parent.append(this.element);
    this.detachDrop = acceptDrops(dropTarget, () => this.acceptDrops, (files) => void this.upload(files, ''));
  }

  render(state: FileListState): void {
    this.state = state;
    for (const folder of this.emptyFolders) if (filesUnder(state.paths, folder).length > 0) this.emptyFolders.delete(folder);
    this.tree.render({ ...state, folders: [...this.emptyFolders], presence: this.others });
    this.updateButtons();
  }

  /** Marks the files other users are in with a colored dot with their initials each. */
  showPresence(presences: readonly PlacedPresence[]): void {
    this.others = new Map();
    for (const { path, user } of presences) this.others.set(path, [...(this.others.get(path) ?? []), user]);
    this.render(this.state);
  }

  destroy(): void {
    this.detachDrop();
    this.element.remove();
  }

  /** Rename and Delete are off for the main file and a folder holding it. */
  private updateButtons(): void {
    const fixed = this.holdsMain(this.tree.current);
    this.rename.disabled = fixed;
    this.remove.disabled = fixed;
  }

  private holdsMain(path: string): boolean {
    return path === this.state.main || this.state.main.startsWith(`${path}/`);
  }

  /** The focused folder as the start of a name: 'chapters/' ('' at the top level). */
  private folderPrefix(): string {
    const folder = this.tree.folder;
    return folder === '' ? '' : `${displayName(folder)}/`;
  }

  private pick(): void {
    this.uploadFolder = this.tree.folder;
    this.picker.click();
  }

  private askCreate(): void {
    this.ask({
      message: 'Name of the new file',
      value: this.folderPrefix(),
      confirm: 'Create',
      submit: async (name) => {
        const target = toPath(name, '.typ');
        if ('error' in target) return target.error;
        return this.request([{ kind: 'create', path: target.path, content: '' }], target.path);
      },
    });
  }

  private askFolder(): void {
    this.ask({
      message: 'Name of the new folder',
      value: this.folderPrefix(),
      confirm: 'Create',
      submit: async (name) => {
        const target = toPath(name, '');
        if ('error' in target) return target.error;
        if (this.state.paths.includes(target.path) || this.tree.isFolder(target.path)) return `${displayName(target.path)} already exists.`;
        this.emptyFolders.add(target.path);
        this.render(this.state);
        this.tree.focus(target.path);
        return null;
      },
    });
  }

  private askRename(from: string): void {
    if (this.holdsMain(from)) return;
    const folder = this.tree.isFolder(from);
    this.ask({
      message: `Rename ${displayName(from)} to`,
      value: displayName(from),
      confirm: 'Rename',
      submit: async (name) => {
        const target = toPath(name, folder ? '' : extensionOf(from));
        if ('error' in target) return target.error;
        return this.relocate(from, target.path);
      },
    });
  }

  private askDelete(path: string): void {
    if (this.holdsMain(path)) return;
    const files = this.tree.isFolder(path) ? filesUnder(this.state.paths, path) : [path];
    const what = files.length === 1 && files[0] === path ? displayName(path) : `${displayName(path)} and the ${files.length} files in it`;
    this.ask({
      message: `Delete ${what}? This cannot be undone.`,
      confirm: 'Delete',
      danger: true,
      submit: async () => {
        this.emptyFolders.delete(path);
        this.render(this.state);
        return this.request(files.map((file) => ({ kind: 'delete', path: file })), this.state.main);
      },
    });
  }

  /** A row dragged onto `folder`. */
  private async move(source: string, folder: string): Promise<void> {
    const target = `${folder}/${source.slice(source.lastIndexOf('/') + 1)}`;
    const error = await this.relocate(source, target);
    if (error) this.ask({ message: error, confirm: 'OK', submit: async () => null });
  }

  /** Moves a file, or a folder with its files, to `target`; opens the moved file. */
  private async relocate(source: string, target: string): Promise<string | null> {
    if (this.holdsMain(source)) return 'The main file stays where it is.';
    const renames = relocate(this.state.paths, source, target);
    if (this.emptyFolders.delete(source)) this.emptyFolders.add(target);
    const open = renames.find((r) => r.from === this.state.active)?.path ?? (renames.length === 1 ? renames[0].path : this.state.active);
    const error = await this.request(renames.map((r) => ({ kind: 'rename', ...r })), open);
    if (!error && renames.length !== 1) this.tree.focus(target);
    return error;
  }

  private async upload(files: File[], folder: string): Promise<void> {
    this.picker.value = '';
    const changes = (await uploadChanges(files)).map((change) => ({ ...change, path: folder + change.path }));
    const error = await this.request(changes, changes[changes.length - 1]?.path ?? null);
    if (error) this.ask({ message: error, confirm: 'OK', submit: async () => null });
  }

  /** Asks for `changes` one after the other (stopping at a refusal), then opens `open` if all were applied. */
  private async request(changes: FileChange[], open: string | null): Promise<string | null> {
    for (const change of changes) {
      const error = await this.options.onChange(change);
      if (error) return error;
    }
    if (open !== null && changes.length > 0) this.options.onOpen(open);
    this.render(this.state);
    return null;
  }

  private ask(prompt: Prompt): void {
    this.prompt?.remove();
    const form = promptForm(this.element.ownerDocument, prompt, () => this.closePrompt());
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const error = await prompt.submit(form.querySelector('input')?.value ?? '');
      if (error === null) this.closePrompt();
      else form.querySelector('.typst-files__error')!.textContent = error;
    });
    this.tree.element.before(form);
    this.prompt = form;
    const input = form.querySelector('input');
    (input ?? form.querySelector('button'))?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }

  private closePrompt(): void {
    this.prompt?.remove();
    this.prompt = null;
  }
}

function promptForm(doc: Document, prompt: Prompt, cancel: () => void): HTMLFormElement {
  const form = element(doc, 'form', 'typst-files__prompt');
  const label = element(doc, 'label', 'typst-files__message');
  label.textContent = prompt.message;
  form.append(label);
  if (prompt.value !== undefined) {
    const input = doc.createElement('input');
    input.value = prompt.value;
    input.placeholder = 'e.g. chapter-2';
    input.setAttribute('aria-label', prompt.message);
    label.append(input);
  }
  const confirm = element(doc, 'button', `typst-files__confirm${prompt.danger ? ' typst-files__confirm--danger' : ''}`);
  confirm.type = 'submit';
  confirm.textContent = prompt.confirm;
  const cancelButton = element(doc, 'button', 'typst-files__cancel');
  cancelButton.type = 'button';
  cancelButton.textContent = 'Cancel';
  cancelButton.addEventListener('click', cancel);
  const error = element(doc, 'span', 'typst-files__error');
  error.setAttribute('role', 'alert');
  form.append(confirm, cancelButton, error);
  form.addEventListener('keydown', (event) => event.key === 'Escape' && cancel());
  return form;
}

/**
 * Calls `onFiles` with files dropped on `target` while `enabled()`; shows a
 * drop hint meanwhile. Files dropped while not enabled are ignored: the
 * browser never opens a dropped file in place of the page. A view inside
 * that takes a drop itself stops its propagation.
 */
function acceptDrops(target: HTMLElement, enabled: () => boolean, onFiles: (files: File[]) => void): () => void {
  let depth = 0;
  const carriesFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes('Files');
  const setDepth = (next: number) => {
    depth = Math.max(0, next);
    target.classList.toggle('typst-editor--dropping', depth > 0);
  };
  const handlers: Record<string, (event: DragEvent) => void> = {
    dragenter: (event) => carriesFiles(event) && enabled() && setDepth(depth + 1),
    dragleave: (event) => carriesFiles(event) && enabled() && setDepth(depth - 1),
    dragover: (event) => carriesFiles(event) && event.preventDefault(),
    drop: (event) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      if (enabled()) onFiles([...(event.dataTransfer?.files ?? [])]);
    },
  };
  // Captured, so the hint also goes when a view inside takes the drop.
  const endHint = () => setDepth(0);
  target.addEventListener('drop', endHint, true);
  for (const [type, handler] of Object.entries(handlers)) target.addEventListener(type, handler as EventListener);
  return () => {
    target.removeEventListener('drop', endHint, true);
    for (const [type, handler] of Object.entries(handlers)) target.removeEventListener(type, handler as EventListener);
  };
}

function iconButton(doc: Document, name: IconName, label: string, onClick: () => void) {
  const button = element(doc, 'button', 'typst-files__action');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(icon(doc, name));
  button.addEventListener('click', onClick);
  return button;
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string) {
  const node = doc.createElement(tag);
  node.className = className;
  return node;
}

