// The History side panel. See changes in ../changes.ts.
import { ProjectPath } from '../../../core/paths/paths';
import type { SourceControl, SourceControlHistoryItem, SourceControlHistoryItemChange } from '../../../hosts/scm/scm';
import { byDay, HistoryList, initials, people, relativeTime, uncommitted, type HistoryScope } from './history-list';

/**
 * The commits of a source control in a side panel: at the top its changes not committed yet ("Not in GitLab yet", no
 * request), then the commits of the scope grouped by day, each with its people's initials, subject, age and short id,
 * and "Load more". Choosing a commit shows the changes since it (`showChangesSince`) and lists the files it changed;
 * the commit the changes are shown since is marked. Choosing a file opens it; one not committed yet shows the changes
 * since the last commit first. Loads only while `visible()`; a new current commit (`refresh`) or scope starts the list
 * anew.
 *
 * Used by: the changes extension, in its side panel `history`.
 */
export class HistoryPanel {
  readonly #root: HTMLElement;
  #control: SourceControl | undefined;
  #list: HistoryList | undefined;
  #scope: HistoryScope;
  #listening: { dispose(): void } | undefined;
  /** The files of the commits shown expanded: loaded, still loading, or why not. */
  readonly #expanded = new Map<string, readonly SourceControlHistoryItemChange[] | 'loading' | { error: string }>();
  #uncommittedOpen = false;

  constructor(
    parent: HTMLElement,
    private readonly options: HistoryPanelOptions,
  ) {
    this.#root = parent.ownerDocument.createElement('div');
    this.#root.className = 'zwf-history';
    parent.append(this.#root);
    this.render();
  }

  get scope(): HistoryScope {
    return this.#scope;
  }

  /** Lists the commits of `scope` (undefined: everything). */
  setScope(scope: HistoryScope): void {
    this.#scope = scope;
    this.refresh();
  }

  /** Starts the list anew (another source control, a new current commit), or loads it if it waits for being seen. */
  refresh(): void {
    const control = this.options.sourceControl();
    this.#listening?.dispose();
    this.#list?.dispose();
    this.#expanded.clear();
    this.#control = control;
    this.#list = control?.historyProvider ? new HistoryList(control.historyProvider, this.#scope) : undefined;
    this.#listening = this.#list?.onDidChange(() => this.render());
    this.shown();
    this.render();
  }

  /** The panel is seen now (or not): the first page loads once it is. */
  shown(): void {
    if (this.options.visible() && this.#list && this.#list.items.length === 0 && this.#list.hasMore && !this.#list.error) void this.#list.loadMore();
  }

  render(): void {
    const doc = this.#root.ownerDocument;
    this.#root.replaceChildren(this.#header(doc));
    const control = this.#control;
    const list = this.#list;
    if (!control || !list) {
      this.#root.append(element(doc, 'p', 'zwf-history__note', 'No history here: the project is not in a repository.'));
      return;
    }
    const ul = element(doc, 'ul', 'zwf-history__list');
    this.#uncommitted(doc, ul, control);
    const now = Date.now();
    for (const group of byDay(list.items, now)) {
      ul.append(element(doc, 'li', 'zwf-history__day', group.label));
      for (const item of group.items) ul.append(this.#entry(doc, control, item, now));
    }
    this.#root.append(ul, ...this.#footer(doc, list));
  }

  dispose(): void {
    this.#listening?.dispose();
    this.#list?.dispose();
    this.#root.remove();
  }

  /** Under the list: loading; else a failure, then "Load more" while there may be more (also after a page without commits), or nothing at all. */
  #footer(doc: Document, list: HistoryList): HTMLElement[] {
    if (list.loading) return [element(doc, 'p', 'zwf-history__note', 'Loading…')];
    const footer: HTMLElement[] = list.error ? [element(doc, 'p', 'zwf-history__note zwf-history__note--error', `The history could not be read: ${list.error}`)] : [];
    if (list.hasMore) footer.push(button(doc, 'zwf-history__more', 'Load more', () => void list.loadMore()));
    else if (list.items.length === 0) footer.push(element(doc, 'p', 'zwf-history__note', 'No commits.'));
    return footer;
  }

  #header(doc: Document): HTMLElement {
    const header = element(doc, 'div', 'zwf-history__header');
    const scope = this.#scope;
    const label = !scope ? 'Project' : `${scope.kind === 'file' ? 'File' : 'Folder'} ${ProjectPath.displayName(scope.path)}`;
    header.append(element(doc, 'span', 'zwf-history__scope', label));
    if (scope) header.append(labelled(button(doc, 'zwf-history__icon', '✕', () => this.setScope(undefined)), 'Show the history of the whole project'));
    header.append(labelled(button(doc, 'zwf-history__icon', '⟳', () => this.refresh()), 'Refresh'));
    return header;
  }

  /** The pseudo-entry of what is not committed yet (when there is any in the scope). */
  #uncommitted(doc: Document, ul: HTMLElement, control: SourceControl): void {
    const states = uncommitted(control.resourceStates ?? [], this.#scope);
    if (states.length === 0) return;
    const li = element(doc, 'li', 'zwf-history__entry zwf-history__entry--uncommitted');
    const row = button(doc, 'zwf-history__row', '', () => {
      this.#uncommittedOpen = !this.#uncommittedOpen;
      this.render();
    });
    row.setAttribute('aria-expanded', String(this.#uncommittedOpen));
    row.append(element(doc, 'span', 'zwf-history__subject', `Not in ${control.label} yet`), element(doc, 'span', 'zwf-history__meta', `${states.length} ${states.length === 1 ? 'file' : 'files'}`));
    li.append(row);
    if (this.#uncommittedOpen) {
      const files = element(doc, 'ul', 'zwf-history__files');
      for (const state of states) {
        files.append(
          this.#file(doc, state.path, state.decorations?.badge ?? 'M', () => {
            this.options.showChangesSince(control, undefined);
            this.options.openFile(state.path);
          }),
        );
      }
      li.append(files);
    }
    ul.append(li);
  }

  #entry(doc: Document, control: SourceControl, item: SourceControlHistoryItem, now: number): HTMLElement {
    const isBaseline = item.id === this.options.baseline()?.id;
    const li = element(doc, 'li', `zwf-history__entry${isBaseline ? ' zwf-history__entry--baseline' : ''}`);
    const expanded = this.#expanded.get(item.id);
    const row = button(doc, 'zwf-history__row', '', () => {
      if (isBaseline) {
        this.#toggle(control, item);
        return;
      }
      if (expanded === undefined) this.#toggle(control, item);
      this.options.showChangesSince(control, item);
    });
    row.setAttribute('aria-expanded', String(expanded !== undefined));
    if (isBaseline) row.setAttribute('aria-current', 'true');
    row.title = `${SINCE_TITLE}\n\n${item.message}`;
    const avatars = element(doc, 'span', 'zwf-history__people');
    for (const name of people(item).slice(0, 3)) {
      const avatar = element(doc, 'span', 'zwf-history__avatar', initials(name));
      avatar.title = name;
      avatars.append(avatar);
    }
    const when = item.timestamp === undefined ? '' : relativeTime(item.timestamp, now);
    row.append(avatars, element(doc, 'span', 'zwf-history__subject', item.subject), element(doc, 'span', 'zwf-history__meta', [when, item.displayId].filter(Boolean).join(' · ')));
    li.append(row);
    if (expanded) li.append(this.#changes(doc, expanded));
    return li;
  }

  /** The files `item` changed, as far as loaded. */
  #changes(doc: Document, expanded: readonly SourceControlHistoryItemChange[] | 'loading' | { error: string }): HTMLElement {
    if (expanded === 'loading') return element(doc, 'p', 'zwf-history__note', 'Loading…');
    if ('error' in expanded) return element(doc, 'p', 'zwf-history__note zwf-history__note--error', expanded.error);
    const files = element(doc, 'ul', 'zwf-history__files');
    for (const change of expanded) files.append(this.#file(doc, change.path, BADGES[change.kind], () => this.options.openFile(change.path)));
    if (expanded.length === 0) files.append(element(doc, 'li', 'zwf-history__note', 'No files changed here.'));
    return files;
  }

  #file(doc: Document, path: ProjectPath, badge: string, open: () => void): HTMLElement {
    const li = element(doc, 'li', 'zwf-history__file');
    const row = button(doc, 'zwf-history__file-row', '', open);
    row.append(element(doc, 'span', 'zwf-history__badge', badge), element(doc, 'span', 'zwf-history__path', ProjectPath.displayName(path)));
    if (!this.options.isOpenable(path)) {
      row.disabled = true;
      row.title = 'Not in the project now';
    }
    li.append(row);
    return li;
  }

  #toggle(control: SourceControl, item: SourceControlHistoryItem): void {
    if (this.#expanded.has(item.id)) {
      this.#expanded.delete(item.id);
      this.render();
      return;
    }
    this.#expanded.set(item.id, 'loading');
    this.render();
    const list = this.#list;
    control.historyProvider!.provideHistoryItemChanges(item.id).then(
      (changes) => this.#loaded(list, item.id, changes),
      (error: unknown) => this.#loaded(list, item.id, { error: `The files could not be read: ${error instanceof Error ? error.message : String(error)}` }),
    );
  }

  #loaded(list: HistoryList | undefined, id: string, files: readonly SourceControlHistoryItemChange[] | { error: string }): void {
    if (list !== this.#list || !this.#expanded.has(id)) return;
    this.#expanded.set(id, files);
    this.render();
  }
}

export interface HistoryPanelOptions {
  /** The source control whose history is shown (the first with a `historyProvider`); undefined: none. */
  sourceControl(): SourceControl | undefined;
  /** Whether the panel is seen. */
  visible(): boolean;
  /** The commit the changes are shown since; undefined: none (not shown, or since the last commit). */
  baseline(): SourceControlHistoryItem | undefined;
  /** Shows the changes since `item` of `control` (undefined: since the last commit). */
  showChangesSince(control: SourceControl, item: SourceControlHistoryItem | undefined): void;
  /** Opens `path` in its editor. */
  openFile(path: ProjectPath): void;
  /** Whether the project has `path` now (only such a file opens). */
  isOpenable(path: ProjectPath): boolean;
}

/** What choosing a commit does (its tooltip, before its message). */
export const SINCE_TITLE = 'Show changes since this commit';

const BADGES: Record<SourceControlHistoryItemChange['kind'], string> = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' };

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function button(doc: Document, className: string, text: string, onClick: () => void): HTMLButtonElement {
  const el = element(doc, 'button', className, text);
  el.type = 'button';
  el.addEventListener('click', onClick);
  return el;
}

/** `el`, named `label` (its tooltip and accessible name). */
function labelled<T extends HTMLElement>(el: T, label: string): T {
  el.title = label;
  el.setAttribute('aria-label', label);
  return el;
}
