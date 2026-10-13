// Where "Find in files" searches. See SearchPanel in search-panel.ts.
import type { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter, type Event } from '../../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../../core/paths/paths';
import type { WindowApi } from '../../../hosts/window/window';
import type { SearchScope } from '../model/search-results';

/**
 * The panel's "in:" line: a choice of the whole project, the current file (the one shown in the editing area, followed
 * as it changes) or a folder with its subfolders, and beside it what that means now: the current file's name, or the
 * folder as a chip whose × goes back to the whole project. Choosing "Folder" takes the current file's folder; another
 * folder comes from `pick` (the file panel's "Find in folder…").
 */
export class ScopePicker {
  readonly element: HTMLElement;
  readonly #changed = new EventEmitter<void>();
  /** Fires when `scope` changed: chosen here or by `pick`, or the current file changed while it is searched. */
  readonly onDidChange: Event<void> = this.#changed.event;
  readonly #select: HTMLSelectElement;
  readonly #target: HTMLElement;
  readonly #name: HTMLElement;
  readonly #clear: HTMLButtonElement;
  readonly #subscription: Disposable;
  #choice: Choice = { kind: 'project' };
  #activeFile: ProjectPath;

  constructor(doc: Document, window: Pick<WindowApi, 'activeFile' | 'onDidChangeActiveFile'>) {
    this.element = element(doc, 'div', 'typst-search__scope');
    this.#select = element(doc, 'select', 'typst-search__scope-select');
    this.#select.setAttribute('aria-label', 'Search in');
    for (const [value, label] of [['project', 'Project'], ['file', 'Current file'], ['folder', 'Folder']]) this.#select.appendChild(element(doc, 'option', '', label)).value = value;
    this.#target = element(doc, 'span', 'typst-search__scope-target');
    this.#name = this.#target.appendChild(element(doc, 'span', 'typst-search__scope-name'));
    this.#clear = this.#target.appendChild(element(doc, 'button', 'typst-search__scope-clear', '×'));
    this.#clear.type = 'button';
    this.#clear.title = 'Search the whole project';
    this.#clear.setAttribute('aria-label', 'Search the whole project');
    this.element.append(element(doc, 'span', 'typst-search__scope-label', 'in'), this.#select, this.#target);
    this.#activeFile = window.activeFile;
    this.#select.addEventListener('change', () => this.#chose(this.#select.value));
    this.#clear.addEventListener('click', () => this.pick({ kind: 'project' }));
    this.#subscription = window.onDidChangeActiveFile((path) => this.#activeFileChanged(path));
    this.#render();
  }

  /** Where to search now. */
  get scope(): SearchScope {
    return this.#choice.kind === 'file' ? { kind: 'file', path: this.#activeFile } : this.#choice;
  }

  /** Searches `choice` from now on: the project, the current file (as it changes) or a folder. */
  pick(choice: Choice): void {
    this.#choice = choice;
    this.#render();
    this.#changed.fire();
  }

  dispose(): void {
    this.#subscription.dispose();
    this.#changed.dispose();
  }

  #chose(value: string): void {
    if (value !== 'folder') return this.pick({ kind: value === 'file' ? 'file' : 'project' });
    // the root is no folder of its own: there "Folder" is the project
    const folder = ProjectPath.parse(this.#activeFile.slice(0, this.#activeFile.lastIndexOf('/')));
    this.pick(folder ? { kind: 'folder', path: folder } : { kind: 'project' });
  }

  #activeFileChanged(path: ProjectPath): void {
    if (path === this.#activeFile) return;
    this.#activeFile = path;
    if (this.#choice.kind !== 'file') return;
    this.#render();
    this.#changed.fire();
  }

  #render(): void {
    const choice = this.#choice;
    this.#select.value = choice.kind;
    this.#target.hidden = choice.kind === 'project';
    this.#target.classList.toggle('typst-search__scope-target--folder', choice.kind === 'folder');
    this.#clear.hidden = choice.kind !== 'folder';
    this.#name.textContent = choice.kind === 'folder' ? `${ProjectPath.displayName(choice.path)}/` : ProjectPath.displayName(this.#activeFile);
  }
}

/** What can be picked: the project, the current file (whichever it is then), or a folder (and its subfolders). */
export type Choice = { readonly kind: 'project' } | { readonly kind: 'file' } | { readonly kind: 'folder'; readonly path: ProjectPath };

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, content?: string): HTMLElementTagNameMap[K] {
  const result = doc.createElement(tag);
  result.className = className;
  if (content !== undefined) result.textContent = content;
  return result;
}
