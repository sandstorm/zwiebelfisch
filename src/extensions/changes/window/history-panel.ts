// The History side panel. See changes in ../changes.ts.
import { ProjectPath } from '../../../core/paths/paths';
import type { SourceControl, SourceControlHistoryItem, SourceControlHistoryItemChange } from '../../../hosts/scm/scm';
import { describe, type Comparison } from '../comparison';
import { byDay, HistoryList, initials, people, relativeTime, shortId, uncommitted, type HistoryScope } from './history-list';

/**
 * The commits of a source control in a side panel: on top the comparison the editors show ("Changes in 84c6e2f
 * “Title”" with ✕ to stop, else "Show changes since last commit"), then the changes not committed yet ("Not in GitLab
 * yet", no request), then the commits of the scope grouped by day, each with its first person's initials (and "+N"),
 * subject, people, age and short id, and "Load more". As IntelliJ's log:
 * - a click on a commit shows its changes (`compare` a `commit`); on the one shown alone, stops (`compare(undefined)`)
 * - a Cmd/Ctrl- or Shift-click on another commit compares the two, the older to the newer (a `range`); so does the next click
 *   after `compareWith`
 * - a right click opens the commit's menu (`showItemMenu`)
 * The commits compared are highlighted (`aria-current`) and labelled ("Changes", "Since", "From", "To"); the one the
 * changes go to (or start at, to the current state) lists the files that differ. Choosing a file opens it as the
 * comparison shows it (`openFile`); one not committed yet shows the changes since the last commit first. Reads the
 * comparison only from `comparison()` on each `render`. Loads only while `visible()`; a new current commit (`refresh`)
 * or scope starts the list anew.
 *
 * Used by: the changes extension, in its side panel `history`.
 */
export class HistoryPanel {
  readonly #root: HTMLElement;
  #control: SourceControl | undefined;
  #list: HistoryList | undefined;
  #scope: HistoryScope;
  #listening: { dispose(): void } | undefined;
  /** The files of the comparisons shown so far, by `filesKey`: loaded, still loading, or why not. */
  readonly #files = new Map<string, Files>();
  #uncommittedOpen = false;
  /** The commit the next click compares with (`compareWith`). */
  #picking: SourceControlHistoryItem | undefined;

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

  /** The next click on a commit compares it with `item` (the strip says so; ✕ there cancels); undefined: cancels. */
  compareWith(item: SourceControlHistoryItem | undefined): void {
    this.#picking = item;
    this.render();
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
    top.append(this.#mode(doc));
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

  /** The strip saying which changes the editors show, with the way to turn them off or on (or which commit is to be picked). */
  #mode(doc: Document): HTMLElement {
    const comparison = this.options.comparison();
    const picking = this.#picking;
    const strip = element(doc, 'div', `zwf-history__mode${comparison || picking ? ' zwf-history__mode--on' : ''}`);
    strip.dataset.testid = 'zwf-history-mode';
    const stop = (label: string, onClick: () => void) => labelled(button(doc, 'zwf-history__icon', '✕', onClick), label);
    if (picking) {
      const text = element(doc, 'span', 'zwf-history__mode-text', `Choose the commit to compare ${shortId(picking)} with`);
      strip.append(text, stop('Cancel', () => this.compareWith(undefined)));
      return strip;
    }
    if (!comparison) {
      strip.append(button(doc, 'zwf-history__show', 'Show changes since last commit', () => this.options.compare({ kind: 'since' })));
      return strip;
    }
    const text = element(doc, 'span', 'zwf-history__mode-text', describe(comparison, Date.now()).long);
    text.title = text.textContent!;
    strip.append(element(doc, 'span', 'zwf-history__dot'), text, stop('Stop showing changes', () => this.options.compare(undefined)));
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
        const change = { path: state.path, kind: BADGE_KINDS[state.decorations?.badge ?? ''] ?? 'modified' };
        files.append(
          this.#file(doc, change, this.options.isOpenable(state.path), () => {
            this.options.compare({ kind: 'since' });
            this.options.openFile(change);
          }),
        );
      }
      li.append(files);
    }
    ul.append(li);
  }

  #entry(doc: Document, control: SourceControl, item: SourceControlHistoryItem, now: number): HTMLElement {
    const comparison = this.options.comparison();
    const role = comparison && roleOf(comparison, item);
    const li = element(doc, 'li', `zwf-history__entry${role ? ' zwf-history__entry--compared' : ''}`);
    const row = button(doc, 'zwf-history__row', '', (event) => this.#choose(item, event.metaKey || event.ctrlKey || event.shiftKey));
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.options.showItemMenu(item, { x: event.clientX, y: event.clientY });
    });
    const listsFiles = role !== undefined && role !== 'from';
    row.setAttribute('aria-expanded', String(listsFiles));
    if (role) row.setAttribute('aria-current', 'true');
    row.title = `${role === 'commit' || role === 'since' ? STOP_TITLE : CHOOSE_TITLE}\n\n${item.message}`;
    const names = people(item);
    const when = item.timestamp === undefined ? '' : relativeTime(item.timestamp, now);
    row.append(this.#people(doc, names), element(doc, 'span', 'zwf-history__subject', item.subject));
    if (role) row.append(element(doc, 'span', 'zwf-history__compared', ROLE_LABELS[role]));
    row.append(element(doc, 'span', 'zwf-history__meta', [names.join(', '), when, shortId(item)].filter(Boolean).join(' · ')));
    li.append(row);
    if (listsFiles) li.append(this.#changes(doc, comparison!, this.#filesOf(control, comparison!)));
    return li;
  }

  /** A click on `item` (`range`: with Cmd/Ctrl or Shift): see the class. */
  #choose(item: SourceControlHistoryItem, range: boolean): void {
    const comparison = this.options.comparison();
    const picking = this.#picking;
    this.#picking = undefined;
    const anchor = picking ?? (range && comparison ? anchorOf(comparison) : undefined);
    if (anchor) {
      if (anchor.id === item.id) this.render();
      else this.options.compare(this.#range(anchor, item));
      return;
    }
    const alone = comparison && comparison.kind !== 'range' && comparison.item?.id === item.id;
    this.options.compare(alone ? undefined : { kind: 'commit', item });
  }

  /** `a` and `b` as a range, the older (further down the list, else earlier) to the newer. */
  #range(a: SourceControlHistoryItem, b: SourceControlHistoryItem): Comparison {
    const items = this.#list?.items ?? [];
    const [ia, ib] = [items.findIndex((each) => each.id === a.id), items.findIndex((each) => each.id === b.id)];
    const aOlder = ia >= 0 && ib >= 0 ? ia > ib : (a.timestamp ?? 0) < (b.timestamp ?? 0);
    return aOlder ? { kind: 'range', from: a, to: b } : { kind: 'range', from: b, to: a };
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

  /** The files that differ in `comparison`, as far as loaded. */
  #changes(doc: Document, comparison: Comparison, files: Files): HTMLElement {
    if (files === 'loading') return element(doc, 'p', 'zwf-history__note zwf-history__note--files', 'Loading…');
    if ('error' in files) return element(doc, 'p', 'zwf-history__note zwf-history__note--files zwf-history__note--error', files.error);
    const ul = element(doc, 'ul', 'zwf-history__files');
    // to a commit: every file opens, as it was there; to the current state only those the project has
    const live = comparison.kind === 'since';
    for (const change of files) ul.append(this.#file(doc, change, !live || this.options.isOpenable(change.path), () => this.options.openFile(change)));
    if (files.length === 0) ul.append(element(doc, 'li', 'zwf-history__note zwf-history__note--files', 'No files changed here.'));
    return ul;
  }

  /** A file's row: its kind as a coloured symbol, its folder (cut from the left when long) and its name. */
  #file(doc: Document, { path, kind }: SourceControlHistoryItemChange, openable: boolean, open: () => void): HTMLElement {
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
    if (!openable) {
      row.disabled = true;
      row.title += '\nNot in the project now';
    }
    li.append(row);
    return li;
  }

  /** The files that differ in `comparison`, as far as loaded; starts loading them the first time (rendering again once they came). */
  #filesOf(control: SourceControl, comparison: Comparison): Files {
    const provider = control.historyProvider!;
    const [to, from] =
      comparison.kind === 'commit' ? [comparison.item.id, undefined] : comparison.kind === 'range' ? [comparison.to.id, comparison.from.id] : [provider.currentHistoryItemRef?.id, comparison.item?.id];
    if (to === undefined) return { error: 'The current commit is not known yet.' };
    if (to === from) return [];
    const key = `${from ?? ''}..${to}`;
    const known = this.#files.get(key);
    if (known) return known;
    this.#files.set(key, 'loading');
    const list = this.#list;
    provider.provideHistoryItemChanges(to, from).then(
      (changes) => this.#loaded(list, key, changes),
      (error: unknown) => this.#loaded(list, key, { error: `The files could not be read: ${error instanceof Error ? error.message : String(error)}` }),
    );
    return 'loading';
  }

  #loaded(list: HistoryList | undefined, key: string, files: Files): void {
    if (list !== this.#list) return;
    this.#files.set(key, files);
    this.render();
  }
}

export interface HistoryPanelOptions {
  /** The source control whose history is shown (the first with a `historyProvider`); undefined: none. */
  sourceControl(): SourceControl | undefined;
  /** Whether the panel is seen. */
  visible(): boolean;
  /** The comparison the editors show; undefined: none. */
  comparison(): Comparison | undefined;
  /** Shows `comparison` in the editors; undefined: stops showing changes. */
  compare(comparison: Comparison | undefined): void;
  /** Opens a file of the comparison shown, as it shows it (to a commit: as it was there). */
  openFile(change: SourceControlHistoryItemChange): void;
  /** Whether the project has `path` now (only such a file opens while the changes go to the current state). */
  isOpenable(path: ProjectPath): boolean;
  /** Shows the menu of `item` at `anchor` (viewport coordinates of a right click). */
  showItemMenu(item: SourceControlHistoryItem, anchor: { readonly x: number; readonly y: number }): void;
}

/** The files that differ, as far as loaded: loaded, still loading, or why not. */
type Files = readonly SourceControlHistoryItemChange[] | 'loading' | { error: string };

/** How a commit takes part in a comparison: its changes alone, the changes since it to now, or one end of a range. */
type Role = 'commit' | 'since' | 'from' | 'to';

/** The part `item` plays in `comparison`; undefined: none. */
function roleOf(comparison: Comparison, item: SourceControlHistoryItem): Role | undefined {
  if (comparison.kind === 'range') return comparison.from.id === item.id ? 'from' : comparison.to.id === item.id ? 'to' : undefined;
  return comparison.item?.id === item.id ? comparison.kind : undefined;
}

/** The commit a Cmd/Ctrl- or Shift-click compares with: the one shown alone, or the start of the range or of the changes to now. */
function anchorOf(comparison: Comparison): SourceControlHistoryItem | undefined {
  return comparison.kind === 'range' ? comparison.from : comparison.item;
}

const ROLE_LABELS: Record<Role, string> = { commit: 'Changes', since: 'Since', from: 'From', to: 'To' };

/** What clicking a commit does (its tooltip, before its message). */
export const CHOOSE_TITLE = 'Click: show the changes of this commit\nCmd/Ctrl- or Shift-click: compare it with the selected commit\nRight click: more';
/** What clicking the commit shown alone does (its tooltip, before its message). */
const STOP_TITLE = 'Click to stop showing changes\nCmd/Ctrl- or Shift-click another commit to compare it with this one';

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

function button(doc: Document, className: string, text: string, onClick: (event: MouseEvent) => void): HTMLButtonElement {
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
