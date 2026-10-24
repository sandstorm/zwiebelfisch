// The History side panel. See changes in ../changes.ts.
import { ProjectPath } from '../../../core/paths/paths';
import type { SourceControl, SourceControlHistoryItem, SourceControlHistoryItemChange } from '../../../hosts/scm/scm';
import { byDay, HistoryList, initials, people, relativeTime, shortId, uncommitted, type HistoryScope } from './history-list';

/**
 * The commits of a source control in a side panel: on top whether the editors show changes and since what ("Showing
 * changes since 84c6e2f “Title”" with ✕ to stop, else "Show changes since last commit"), then the changes not committed
 * yet ("Not in GitLab yet", no request), then the commits of the scope grouped by day, each with its first person's
 * initials (and "+N"), subject, people, age and short id, and "Load more". Choosing a commit shows the changes since it
 * (`showChangesSince`); the commit they are shown since is highlighted ("Compared", `aria-current`) and lists the
 * files it changed; choosing it again stops showing them (`hideChanges`). Choosing a file opens it; one not committed
 * yet shows the changes since the last commit first. Reads the mode only from `changes()` on each `render`. Loads only
 * while `visible()`; a new current commit (`refresh`) or scope starts the list anew.
 *
 * Used by: the changes extension, in its side panel `history`.
 */
export class HistoryPanel {
  readonly #root: HTMLElement;
  #control: SourceControl | undefined;
  #list: HistoryList | undefined;
  #scope: HistoryScope;
  #listening: { dispose(): void } | undefined;
  /** The files of the commits compared so far, by id: loaded, still loading, or why not. */
  readonly #files = new Map<string, readonly SourceControlHistoryItemChange[] | 'loading' | { error: string }>();
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
    this.#files.clear();
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
    const top = element(doc, 'div', 'zwf-history__top');
    top.append(this.#header(doc));
    this.#root.replaceChildren(top);
    const control = this.#control;
    const list = this.#list;
    if (!control || !list) {
      this.#root.append(element(doc, 'p', 'zwf-history__note', 'No history here: the project is not in a repository.'));
      return;
    }
    top.append(this.#mode(doc, control));
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

  /** The strip saying whether the editors show changes, and since what, with the way to turn them off or on. */
  #mode(doc: Document, control: SourceControl): HTMLElement {
    const changes = this.options.changes();
    const strip = element(doc, 'div', `zwf-history__mode${changes ? ' zwf-history__mode--on' : ''}`);
    strip.dataset.testid = 'zwf-history-mode';
    if (!changes) {
      strip.append(button(doc, 'zwf-history__show', 'Show changes since last commit', () => this.options.showChangesSince(control, undefined)));
      return strip;
    }
    const since = changes.item ? `${shortId(changes.item)} “${changes.item.subject}”` : 'last commit';
    const text = element(doc, 'span', 'zwf-history__mode-text', `Showing changes since ${since}`);
    text.title = text.textContent!;
    strip.append(element(doc, 'span', 'zwf-history__dot'), text, labelled(button(doc, 'zwf-history__icon', '✕', () => this.options.hideChanges()), 'Stop showing changes'));
    return strip;
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
    row.append(element(doc, 'span', 'zwf-history__people'), element(doc, 'span', 'zwf-history__subject', `Not in ${control.label} yet`), element(doc, 'span', 'zwf-history__meta', `${states.length} ${states.length === 1 ? 'file' : 'files'}`));
    li.append(row);
    if (this.#uncommittedOpen) {
      const files = element(doc, 'ul', 'zwf-history__files');
      for (const state of states) {
        files.append(
          this.#file(doc, state.path, BADGE_KINDS[state.decorations?.badge ?? ''] ?? 'modified', () => {
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
    const compared = item.id === this.options.changes()?.item?.id;
    const li = element(doc, 'li', `zwf-history__entry${compared ? ' zwf-history__entry--compared' : ''}`);
    const row = button(doc, 'zwf-history__row', '', () => (compared ? this.options.hideChanges() : this.options.showChangesSince(control, item)));
    row.setAttribute('aria-expanded', String(compared));
    if (compared) row.setAttribute('aria-current', 'true');
    row.title = `${compared ? STOP_TITLE : SINCE_TITLE}\n\n${item.message}`;
    const names = people(item);
    const when = item.timestamp === undefined ? '' : relativeTime(item.timestamp, now);
    row.append(this.#people(doc, names), element(doc, 'span', 'zwf-history__subject', item.subject));
    if (compared) row.append(element(doc, 'span', 'zwf-history__compared', 'Compared'));
    row.append(element(doc, 'span', 'zwf-history__meta', [names.join(', '), when, shortId(item)].filter(Boolean).join(' · ')));
    li.append(row);
    if (compared) li.append(this.#changes(doc, this.#filesOf(control, item)));
    return li;
  }

  /** The avatar column: the first person's initials, "+N" for the others, all names as tooltip. */
  #people(doc: Document, names: readonly string[]): HTMLElement {
    const column = element(doc, 'span', 'zwf-history__people');
    if (names.length === 0) return column;
    column.title = names.join(', ');
    column.append(element(doc, 'span', 'zwf-history__avatar', initials(names[0])));
    if (names.length > 1) column.append(element(doc, 'span', 'zwf-history__others', `+${names.length - 1}`));
    return column;
  }

  /** The files `item` changed, as far as loaded. */
  #changes(doc: Document, files: readonly SourceControlHistoryItemChange[] | 'loading' | { error: string }): HTMLElement {
    if (files === 'loading') return element(doc, 'p', 'zwf-history__note zwf-history__note--files', 'Loading…');
    if ('error' in files) return element(doc, 'p', 'zwf-history__note zwf-history__note--files zwf-history__note--error', files.error);
    const ul = element(doc, 'ul', 'zwf-history__files');
    for (const change of files) ul.append(this.#file(doc, change.path, change.kind, () => this.options.openFile(change.path)));
    if (files.length === 0) ul.append(element(doc, 'li', 'zwf-history__note zwf-history__note--files', 'No files changed here.'));
    return ul;
  }

  /** A file's row: its kind as a coloured symbol, its folder (cut from the left when long) and its name. */
  #file(doc: Document, path: ProjectPath, kind: SourceControlHistoryItemChange['kind'], open: () => void): HTMLElement {
    const li = element(doc, 'li', 'zwf-history__file');
    const row = button(doc, 'zwf-history__file-row', '', open);
    const symbol = labelled(element(doc, 'span', `zwf-history__kind zwf-history__kind--${kind}`, KINDS[kind].symbol), KINDS[kind].label);
    symbol.setAttribute('role', 'img');
    const name = ProjectPath.name(path);
    const folder = element(doc, 'span', 'zwf-history__folder');
    folder.append(element(doc, 'bdi', '', ProjectPath.displayName(path).slice(0, -name.length)));
    const shown = element(doc, 'span', 'zwf-history__path');
    shown.append(folder, element(doc, 'span', 'zwf-history__name', name));
    row.append(symbol, shown);
    row.title = ProjectPath.displayName(path);
    if (!this.options.isOpenable(path)) {
      row.disabled = true;
      row.title += '\nNot in the project now';
    }
    li.append(row);
    return li;
  }

  /** The files of `item`, as far as loaded; starts loading them the first time (rendering again once they came). */
  #filesOf(control: SourceControl, item: SourceControlHistoryItem): readonly SourceControlHistoryItemChange[] | 'loading' | { error: string } {
    const known = this.#files.get(item.id);
    if (known) return known;
    this.#files.set(item.id, 'loading');
    const list = this.#list;
    control.historyProvider!.provideHistoryItemChanges(item.id).then(
      (changes) => this.#loaded(list, item.id, changes),
      (error: unknown) => this.#loaded(list, item.id, { error: `The files could not be read: ${error instanceof Error ? error.message : String(error)}` }),
    );
    return 'loading';
  }

  #loaded(list: HistoryList | undefined, id: string, files: readonly SourceControlHistoryItemChange[] | { error: string }): void {
    if (list !== this.#list) return;
    this.#files.set(id, files);
    this.render();
  }
}

export interface HistoryPanelOptions {
  /** The source control whose history is shown (the first with a `historyProvider`); undefined: none. */
  sourceControl(): SourceControl | undefined;
  /** Whether the panel is seen. */
  visible(): boolean;
  /** What the editors show the changes since: undefined: they show none; `item` undefined: the last commit. */
  changes(): { readonly item: SourceControlHistoryItem | undefined } | undefined;
  /** Shows the changes since `item` of `control` (undefined: since the last commit). */
  showChangesSince(control: SourceControl, item: SourceControlHistoryItem | undefined): void;
  /** Stops showing the changes. */
  hideChanges(): void;
  /** Opens `path` in its editor. */
  openFile(path: ProjectPath): void;
  /** Whether the project has `path` now (only such a file opens). */
  isOpenable(path: ProjectPath): boolean;
}

/** What choosing a commit does (its tooltip, before its message). */
export const SINCE_TITLE = 'Show changes since this commit';
/** What choosing the compared commit does (its tooltip, before its message). */
const STOP_TITLE = 'Compared: click to stop showing changes';

const KINDS: Record<SourceControlHistoryItemChange['kind'], { symbol: string; label: string }> = {
  added: { symbol: '+', label: 'Added' },
  deleted: { symbol: '−', label: 'Deleted' },
  modified: { symbol: '~', label: 'Modified' },
  renamed: { symbol: '→', label: 'Renamed' },
};

/** The kind of a file not committed yet, by its source control's badge (others: modified). */
const BADGE_KINDS: Partial<Record<string, SourceControlHistoryItemChange['kind']>> = { A: 'added', D: 'deleted', R: 'renamed' };

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  if (className) el.className = className;
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
