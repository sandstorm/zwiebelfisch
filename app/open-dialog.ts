// The Open dialog of the start page, as IntelliJ's: for a GitLab project, the branch and the project folder in it,
// or a new folder from a template (docs/20_features/17_start-page.typ). Used by start.ts.

import { api, type Folders, type Template } from './api';
import { el } from './dom';
import { type GitLabLocation, roomOf } from './gitlab-location';

/**
 * The room to open for `target`: at once when it names a branch (a pasted URL or room), else what the user picks
 * in the dialog; null when they cancel.
 */
export async function showOpenDialog(target: GitLabLocation): Promise<string | null> {
  if (target.branch) return roomOf({ ...target, branch: target.branch });
  const dialog = new OpenDialog(target.project);
  document.getElementById('start')!.append(dialog.element);
  try {
    return await dialog.result;
  } finally {
    dialog.element.remove();
  }
}

/** The templates a new folder `path` may start from: those whose scope holds its parent, nearest first. */
export function templatesFor(templates: readonly Template[], path: string): Template[] {
  const parent = path.replace(/\/[^/]*\/?$/, '') || '/';
  const holds = (scope: string): boolean => scope === '/' || parent === scope || parent.startsWith(`${scope}/`);
  return templates.filter((template) => holds(template.scope)).sort((a, b) => b.scope.length - a.scope.length);
}

class OpenDialog {
  readonly element = el('dialog');
  readonly result: Promise<string | null>;
  private readonly branch = el('select');
  private readonly choices = el('div', { className: 'choices' });
  private readonly newPath = el('input', { type: 'text', placeholder: '/2026/q3', spellcheck: false });
  private readonly template = el('select');
  private readonly status = el('p', { className: 'meta' });
  private readonly submit = el('button', { type: 'submit', className: 'primary', textContent: 'Open' });
  private folders: Folders = { folders: [], templates: [] };
  private resolve!: (room: string | null) => void;

  constructor(private readonly project: string) {
    this.result = new Promise((resolve) => (this.resolve = resolve));
    const cancel = el('button', { type: 'button', textContent: 'Cancel' });
    const actions = el('div', { className: 'actions' });
    actions.append(cancel, this.submit);
    const form = el('form', { method: 'dialog' });
    form.append(el('h3', { textContent: `Open ${project}` }), row('Branch', this.branch), row('Project', this.choices), this.status, actions);
    this.element.append(form);
    cancel.addEventListener('click', () => this.close(null));
    this.element.addEventListener('cancel', () => this.resolve(null));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.open();
    });
    this.newPath.addEventListener('input', () => {
      this.choices.querySelector<HTMLInputElement>('input[value=""]')!.checked = true;
      this.fillTemplates();
    });
    this.branch.addEventListener('change', () => void this.loadFolders());
    queueMicrotask(() => this.element.showModal());
    void this.loadBranches();
  }

  private async loadBranches(): Promise<void> {
    try {
      const branches = await api.branches(this.project);
      this.branch.replaceChildren(
        ...branches.branches.map((name) => el('option', { value: name, textContent: name, selected: name === branches.default })),
      );
      await this.loadFolders();
    } catch (error) {
      this.say(`The project could not be read: ${(error as Error).message}`);
    }
  }

  private async loadFolders(): Promise<void> {
    this.say('Looking for projects …');
    this.submit.disabled = true;
    try {
      this.folders = await api.folders(this.project, this.branch.value);
      const list = this.folders.folders.length ? this.folders.folders : ['/'];
      const newFolder = el('div');
      newFolder.append(radio('', 'New:', false), this.newPath, ' from ', this.template);
      this.choices.replaceChildren(
        ...list.map((folder, index) => radio(folder, folder === '/' ? '/ (the whole repository)' : folder, index === 0)),
        newFolder,
      );
      this.fillTemplates();
      this.say('');
      this.submit.disabled = false;
    } catch (error) {
      this.say(`The branch could not be read: ${(error as Error).message}`);
    }
  }

  private fillTemplates(): void {
    const path = normalize(this.newPath.value);
    const options = path ? templatesFor(this.folders.templates, path) : [];
    this.template.replaceChildren(
      ...options.map((t) => el('option', { value: t.path, textContent: `${t.name} (${t.path})` })),
      el('option', { value: '', textContent: 'Empty (one main.typ)' }),
    );
  }

  /** Opens the chosen folder, or makes the new one first. */
  private async open(): Promise<void> {
    const folder = this.choices.querySelector<HTMLInputElement>('input[name="folder"]:checked')?.value;
    if (folder === undefined) return;
    if (folder) {
      this.close(roomOf({ project: this.project, branch: this.branch.value, folder }));
      return;
    }
    const path = normalize(this.newPath.value);
    if (!path) {
      this.say('Name the new folder, e.g. /2026/q3.');
      return;
    }
    this.submit.disabled = true;
    this.say('Creating …');
    try {
      this.close(await api.createFolder(this.project, this.branch.value, path, this.template.value));
    } catch (error) {
      this.say((error as Error).message);
      this.submit.disabled = false;
    }
  }

  private close(room: string | null): void {
    this.element.close();
    this.resolve(room);
  }

  private say(text: string): void {
    this.status.textContent = text;
  }
}

function row(label: string, control: HTMLElement): HTMLElement {
  const box = el('div', { className: 'row' });
  box.append(el('label', { textContent: label }), control);
  return box;
}

function radio(value: string, text: string, checked: boolean): HTMLElement {
  const label = el('label');
  label.append(el('input', { type: 'radio', name: 'folder', value, checked }), ` ${text}`);
  return label;
}

/** `/a/b` from what was typed (`a/b/`, ` /a//b `); empty for nothing or the root. */
function normalize(path: string): string {
  const parts = path.split('/').map((part) => part.trim()).filter(Boolean);
  return parts.length ? `/${parts.join('/')}` : '';
}
