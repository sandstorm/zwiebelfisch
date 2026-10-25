// The start page's search field: completes from the GitLab projects the user may edit (GET /api/gitlab/projects),
// and takes a pasted GitLab URL or room (gitlab-location.ts). Used by start.ts.

import { api, type Project } from './api';
import { el } from './dom';
import { type GitLabLocation, parseGitLabLocation } from './gitlab-location';

const DEBOUNCE_MS = 200;

export interface ProjectSearchOptions {
  /** A project was picked from the suggestions. */
  readonly onPick: (project: string) => void;
  /** A GitLab URL or room was entered. */
  readonly onLocation: (location: GitLabLocation) => void;
}

/** The search field with its suggestions. */
export function projectSearch(options: ProjectSearchOptions): HTMLElement {
  return new ProjectSearch(options).element;
}

class ProjectSearch {
  readonly element = el('div', { className: 'search' });
  private readonly input = el('input', {
    type: 'search',
    placeholder: 'Search GitLab projects, or paste a GitLab URL …',
    autocomplete: 'off',
    spellcheck: false,
  });
  private readonly list = el('ul', { className: 'suggestions', hidden: true });
  private projects: Project[] = [];
  private selected = 0;
  private pending: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: ProjectSearchOptions) {
    this.input.setAttribute('aria-label', 'Search GitLab projects');
    this.list.setAttribute('role', 'listbox');
    this.element.append(this.input, this.list);
    this.input.addEventListener('input', () => this.typed());
    this.input.addEventListener('keydown', (event) => this.key(event));
    this.input.addEventListener('blur', () => (this.list.hidden = true));
    this.input.addEventListener('focus', () => this.render());
    queueMicrotask(() => this.input.focus());
  }

  private typed(): void {
    clearTimeout(this.timer);
    const text = this.input.value.trim();
    if (parseGitLabLocation(text)) this.show([]);
    else this.timer = setTimeout(() => void this.search(text), DEBOUNCE_MS);
  }

  private key(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const count = this.projects.length;
      if (count) this.select((this.selected + (event.key === 'ArrowDown' ? 1 : count - 1)) % count);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const location = parseGitLabLocation(this.input.value);
      if (location) this.options.onLocation(location);
      else if (this.projects[this.selected]) this.options.onPick(this.projects[this.selected]!.path);
    } else if (event.key === 'Escape') this.show([]);
  }

  private async search(text: string): Promise<void> {
    this.pending?.abort();
    this.pending = new AbortController();
    try {
      this.show(text ? await api.projects(text, this.pending.signal) : []);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') this.show([]);
    }
  }

  private show(projects: Project[]): void {
    this.projects = projects;
    this.select(0);
  }

  private select(index: number): void {
    this.selected = index;
    this.render();
  }

  private render(): void {
    this.list.replaceChildren(...this.projects.map((project, index) => this.item(project, index)));
    this.list.hidden = this.projects.length === 0;
  }

  private item(project: Project, index: number): HTMLElement {
    const item = el('li');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(index === this.selected));
    item.append(el('strong', { textContent: project.path }), el('span', { className: 'meta', textContent: project.name }));
    item.addEventListener('mousedown', (event) => {
      event.preventDefault();
      this.options.onPick(project.path);
    });
    return item;
  }
}
