import { initials, presenceStyle, type PlacedPresence, type PresenceUser } from '../../core/typst-document/presence';
import { displayName, extensionOf, fileKind, toPath, type FileKind } from '../../core/project/paths';
import { uploadChanges } from './upload';
import type { FileChange } from '../../core/project/project';

export interface FileSwitcherOptions {
  /** Someone picked a file. */
  onOpen(path: string): void;
  /** Someone asked for `change`. Resolves to why it was refused (shown to them), or null once applied. */
  onChange(change: FileChange): Promise<string | null>;
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

const ICONS: Record<FileKind | 'add' | 'upload' | 'rename' | 'delete', string> = {
  typst: '<path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13M6.5 8.5h4M6.5 11h4"/>',
  image: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1.2"/><path d="m2.5 12 3.5-3.5 2.5 2.5 2-2 3 3"/>',
  data: '<path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13"/>',
  add: '<path d="M8 3v10M3 8h10"/>',
  upload: '<path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M3 13h10"/>',
  rename: '<path d="m10.5 2.5 3 3L6 13H3v-3z"/>',
  delete: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9"/>',
};

/**
 * The file bar shown above the editing views of a multi-file project: one tab
 * per file (the main file marked), plus "New file", "Upload", "Rename" and
 * "Delete". Names are asked for inline, and refused changes show why. Files
 * dropped on `dropTarget` are uploaded. It only turns gestures into
 * `FileChange`s; whether they happen is up to `onChange`.
 */
export class FileSwitcher {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private readonly rename: HTMLButtonElement;
  private readonly remove: HTMLButtonElement;
  private readonly picker: HTMLInputElement;
  private prompt: HTMLFormElement | null = null;
  private state: FileListState = { paths: [], main: '', active: '' };
  /** Who else is in which file. */
  private others = new Map<string, PresenceUser[]>();
  private readonly detachDrop: () => void;

  constructor(
    parent: HTMLElement,
    dropTarget: HTMLElement,
    private readonly options: FileSwitcherOptions,
  ) {
    const doc = parent.ownerDocument;
    this.element = element(doc, 'div', 'typst-files');
    this.element.dataset.testid = 'typst-files';
    this.list = element(doc, 'div', 'typst-files__list');
    this.list.setAttribute('role', 'tablist');
    this.list.setAttribute('aria-label', 'Files');
    this.list.addEventListener('click', (event) => {
      const path = (event.target as HTMLElement).closest<HTMLElement>('[data-path]')?.dataset.path;
      if (path) options.onOpen(path);
    });
    this.picker = doc.createElement('input');
    this.picker.type = 'file';
    this.picker.multiple = true;
    this.picker.hidden = true;
    this.picker.addEventListener('change', () => void this.upload([...(this.picker.files ?? [])]));
    const actions = element(doc, 'div', 'typst-files__actions');
    actions.append(
      withText(iconButton(doc, 'add', 'New file', () => this.askCreate())),
      withText(iconButton(doc, 'upload', 'Upload', () => this.picker.click())),
      (this.rename = iconButton(doc, 'rename', 'Rename', () => this.askRename())),
      (this.remove = iconButton(doc, 'delete', 'Delete', () => this.askDelete())),
    );
    this.element.append(this.list, actions, this.picker);
    parent.prepend(this.element);
    this.detachDrop = acceptDrops(dropTarget, () => !this.element.hidden, (files) => void this.upload(files));
  }

  set visible(visible: boolean) {
    this.element.hidden = !visible;
  }

  render(state: FileListState): void {
    this.state = state;
    const doc = this.element.ownerDocument;
    this.list.replaceChildren(...state.paths.map((path) => fileTab(doc, path, state, this.others.get(path) ?? [])));
    const fixed = state.active === state.main;
    this.rename.disabled = fixed;
    this.remove.disabled = fixed;
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

  private askCreate(): void {
    this.ask({
      message: 'Name of the new file',
      value: '',
      confirm: 'Create',
      submit: async (name) => {
        const target = toPath(name, '.typ');
        if ('error' in target) return target.error;
        return this.request({ kind: 'create', path: target.path, content: '' }, target.path);
      },
    });
  }

  private askRename(): void {
    const from = this.state.active;
    this.ask({
      message: `Rename ${displayName(from)} to`,
      value: displayName(from),
      confirm: 'Rename',
      submit: async (name) => {
        const target = toPath(name, extensionOf(from));
        if ('error' in target) return target.error;
        if (target.path === from) return null;
        return this.request({ kind: 'rename', from, path: target.path }, target.path);
      },
    });
  }

  private askDelete(): void {
    const path = this.state.active;
    this.ask({
      message: `Delete ${displayName(path)}? This cannot be undone.`,
      confirm: 'Delete',
      danger: true,
      submit: () => this.request({ kind: 'delete', path }, this.state.main),
    });
  }

  private async upload(files: File[]): Promise<void> {
    this.picker.value = '';
    let opened: string | null = null;
    for (const change of await uploadChanges(files)) {
      const error = await this.options.onChange(change);
      if (error) return this.ask({ message: error, confirm: 'OK', submit: async () => null });
      opened = change.path;
    }
    if (opened) this.options.onOpen(opened);
  }

  /** Asks for `change`, then opens `open` if it was applied. */
  private async request(change: FileChange, open: string): Promise<string | null> {
    const error = await this.options.onChange(change);
    if (!error) this.options.onOpen(open);
    return error;
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
    this.element.after(form);
    this.prompt = form;
    (form.querySelector('input') ?? form.querySelector('button'))?.focus();
  }

  private closePrompt(): void {
    this.prompt?.remove();
    this.prompt = null;
  }
}

function fileTab(doc: Document, path: string, state: FileListState, others: readonly PresenceUser[]): HTMLButtonElement {
  const tab = element(doc, 'button', 'typst-files__tab');
  tab.type = 'button';
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-selected', String(path === state.active));
  tab.dataset.path = path;
  tab.title = displayName(path);
  const name = element(doc, 'span', 'typst-files__name');
  name.textContent = displayName(path);
  tab.append(icon(doc, fileKind(path)), name);
  if (path === state.main) {
    const badge = element(doc, 'span', 'typst-files__badge');
    badge.textContent = 'Main';
    tab.append(badge);
  }
  if (others.length > 0) tab.append(presenceDots(doc, others));
  return tab;
}

/** One dot per user in the file: initials on their color, the name as tooltip. */
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

function iconButton(doc: Document, kind: keyof typeof ICONS, label: string, onClick: () => void) {
  const button = element(doc, 'button', 'typst-files__action');
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.append(icon(doc, kind));
  button.addEventListener('click', onClick);
  return button;
}

/** Shows the button's label next to its icon. */
function withText(button: HTMLButtonElement): HTMLButtonElement {
  button.append(button.title);
  return button;
}

function icon(doc: Document, kind: keyof typeof ICONS): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('typst-files__icon');
  svg.innerHTML = ICONS[kind];
  return svg;
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string) {
  const node = doc.createElement(tag);
  node.className = className;
  return node;
}
