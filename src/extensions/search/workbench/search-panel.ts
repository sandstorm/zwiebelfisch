// The "Find in files" panel's view. See search in ../search.ts.
import type { Disposable } from '../../../core/disposable/disposable';
import { ProjectPath } from '../../../core/paths/paths';
import { keyLabel } from '../../../hosts/commands/commands';
import type { WindowApi } from '../../../hosts/window/window';
import type { Memento, SidePanel } from '../../../hosts/workbench/workbench';
import type { MatchPreview } from '../model/match-preview';
import type { FileMatches, SearchResults, SearchScope } from '../model/search-results';
import type { MatchHighlights } from './match-highlights';
import { type TextMatch, TextQuery } from '../model/text-query';
import { ReplaceControls, type ReplaceControlsOptions } from './replace-controls';
import { type Choice, ScopePicker } from './scope-picker';

/**
 * The query field with its three options (Match Case, Match Whole Word, Use Regular Expression), where to search
 * (ScopePicker: the project, the current file or a folder), what the search found in words ("23 results in 4 files",
 * an invalid regular expression, too many results), and the matches as a tree: a row per file (name, folder, count)
 * with a row per match below (line number, the source line cut so the match comes early, the match marked, wrapped
 * to a few rows; `previewMatches`). Files with many matches start collapsed (VS Code's `search.collapseResults: auto`),
 * and only an expanded file's rows are made. With no query it shows the keys that lead here instead.
 *
 * Typing searches after a short pause, the previous search stopped; the options, the scope and Enter search at once.
 * Results follow the files' changes, redrawn at most every few milliseconds, while the panel is shown: a hidden panel
 * drops its results (nobody sees them go stale) and searches again when it is shown, keeping what was expanded. The
 * tree is one tab stop (↑ / ↓, Home / End, ← / → collapse and expand; ↓ from the field enters it); a click or Enter on
 * a match opens it. The editors highlight what the panel lists, the match row the tree is on emphasised.
 *
 * It has two modes, switched in its header (or by the keys that show it in a mode), remembered across visits: Find,
 * and Replace, which adds the replace field (ReplaceControls), shows each match struck through with its replacement
 * after it, and offers a replace per match (on hover, or ⇧⌘1 / Ctrl+Shift+1 on its row), per file and for all
 * (⌥⌘↩ / Ctrl+Alt+Enter). Query, options and scope stay when the mode changes.
 */
export class SearchPanel {
  readonly #root: HTMLElement;
  readonly #modes: Record<Mode, HTMLButtonElement>;
  readonly #input: HTMLInputElement;
  readonly #toggles: Record<ToggleName, HTMLButtonElement>;
  readonly #scope: ScopePicker;
  readonly #replace: ReplaceControls;
  readonly #replaceAll: HTMLButtonElement;
  readonly #subscriptions: { dispose(): void }[];
  readonly #message: HTMLElement;
  readonly #empty: HTMLElement;
  readonly #tree: HTMLElement;
  #mode: Mode;
  #results: SearchResults | null = null;
  /** The query `#results` are for. */
  #query: TextQuery | null = null;
  #listener: Disposable | null = null;
  #error: string | undefined;
  /** Whether `#results` are still being searched for. */
  #searching = false;
  /** Whether results were dropped while the panel was hidden, to search again when it is shown. */
  #stale = false;
  /** The files the viewer expanded (true) or collapsed (false) in this search; the others as `AUTO_COLLAPSE` says. */
  readonly #expanded = new Map<ProjectPath, boolean>();
  #rows: Row[] = [];
  /** The row that is the tree's tab stop (`Row.key`). */
  #current: string | null = null;
  #typing: ReturnType<typeof setTimeout> | undefined;
  #redraw: ReturnType<typeof setTimeout> | undefined;

  constructor(
    parent: HTMLElement,
    private readonly options: SearchPanelOptions,
  ) {
    const doc = parent.ownerDocument;
    this.#root = element(doc, 'div', 'zwf-search');
    this.#root.dataset.testid = 'zwf-search';
    const modes = element(doc, 'div', 'zwf-search__modes');
    modes.setAttribute('role', 'group');
    modes.setAttribute('aria-label', 'Mode');
    this.#modes = { find: modes.appendChild(modeButton(doc, 'Find')), replace: modes.appendChild(modeButton(doc, 'Replace')) };
    const field = element(doc, 'div', 'zwf-search__field');
    this.#input = field.appendChild(element(doc, 'input', 'zwf-search__input'));
    this.#input.type = 'text';
    this.#input.placeholder = 'Find';
    this.#input.setAttribute('aria-label', 'Find');
    this.#input.spellcheck = false;
    this.#toggles = {
      isCaseSensitive: field.appendChild(toggle(doc, 'Aa', 'Match Case')),
      isWordMatch: field.appendChild(toggle(doc, 'ab', 'Match Whole Word')),
      isRegExp: field.appendChild(toggle(doc, '.*', 'Use Regular Expression')),
    };
    this.#replace = new ReplaceControls(doc, options);
    this.#scope = new ScopePicker(doc, options.window);
    const status = element(doc, 'div', 'zwf-search__status');
    this.#message = status.appendChild(element(doc, 'p', 'zwf-search__message'));
    this.#message.setAttribute('role', 'status');
    this.#replaceAll = status.appendChild(element(doc, 'button', 'zwf-search__button zwf-search__replace-all', 'Replace all'));
    this.#replaceAll.type = 'button';
    this.#replaceAll.title = `Replace all (${keyLabel(REPLACE_ALL_KEY)})`;
    this.#empty = element(doc, 'dl', 'zwf-search__empty');
    for (const { label, key } of options.keys) this.#empty.append(element(doc, 'dt', 'zwf-search__empty-label', label), element(doc, 'dd', 'zwf-search__empty-key', key));
    this.#tree = element(doc, 'ul', 'zwf-search__tree');
    this.#tree.setAttribute('role', 'tree');
    this.#tree.setAttribute('aria-label', 'Results');
    this.#root.append(modes, field, this.#replace.field, this.#scope.element, status, this.#replace.notice, this.#empty, this.#tree);
    parent.append(this.#root);
    // the query field, not the mode buttons before it, takes the focus when the panel is shown by its key; marked once
    // in place, so the browser's own autofocus on insertion does not take the page's focus
    this.#input.autofocus = true;
    this.#mode = options.state.get('mode') === 'replace' ? 'replace' : 'find';
    for (const mode of MODES) this.#modes[mode].addEventListener('click', () => this.#setMode(mode));
    this.#replaceAll.addEventListener('click', () => this.#replaceMatches());
    this.#root.addEventListener('keydown', (event) => this.#rootKeydown(event));
    this.#input.addEventListener('input', () => this.#typed());
    this.#input.addEventListener('keydown', (event) => this.#inputKeydown(event));
    for (const button of Object.values(this.#toggles)) button.addEventListener('click', () => this.#toggle(button));
    this.#tree.addEventListener('click', (event) => this.#click(event));
    this.#tree.addEventListener('keydown', (event) => this.#treeKeydown(event));
    this.#subscriptions = [
      this.#scope,
      this.#replace,
      this.#scope.onDidChange(() => this.#search()),
      this.#replace.onDidChange(() => this.#scheduleRender()),
      options.view.onDidChangeVisibility(() => this.#visibilityChanged()),
    ];
    this.#setMode(this.#mode);
  }

  /**
   * Searches for what `options` sets, in `mode` and `scope` if given (the rest as it is) right away, and focuses the
   * query field with its text selected, to type over.
   */
  find(options: FindOptions = {}, { mode, scope }: { mode?: Mode; scope?: Choice } = {}): void {
    if (options.query !== undefined) this.#input.value = options.query;
    if (options.replace !== undefined) this.#replace.text = options.replace;
    if (mode) this.#setMode(mode);
    if (scope) this.#scope.pick(scope);
    const set: Record<ToggleName, boolean | undefined> = { isCaseSensitive: options.isCaseSensitive, isWordMatch: options.matchWholeWord, isRegExp: options.isRegex };
    for (const name of TOGGLES) if (set[name] !== undefined) this.#toggles[name].setAttribute('aria-pressed', String(set[name]));
    this.#search();
    this.#input.focus();
    this.#input.select();
  }

  dispose(): void {
    clearTimeout(this.#typing);
    clearTimeout(this.#redraw);
    for (const subscription of this.#subscriptions) subscription.dispose();
    this.#drop();
    this.#root.remove();
  }

  #setMode(mode: Mode): void {
    this.#mode = mode;
    this.#root.classList.toggle('zwf-search--replace', mode === 'replace');
    for (const each of MODES) this.#modes[each].setAttribute('aria-pressed', String(each === mode));
    this.#replace.field.hidden = mode !== 'replace';
    if (mode !== this.options.state.get('mode', 'find')) void this.options.state.update('mode', mode);
    this.#render();
  }

  /**
   * Replaces the matches of file `path` and, with `match`, that match only; else all. All are confirmed when many.
   * What is replaced is what the results have then (they follow every change).
   */
  #replaceMatches(path?: ProjectPath, match?: TextMatch): void {
    const results = this.#results;
    const query = this.#query;
    if (this.#mode !== 'replace' || !results || !query) return;
    const files = (): FileMatches[] => {
      if (match) return [{ path: path!, matches: [match] }];
      return results.files().filter((file) => path === undefined || file.path === path);
    };
    void this.#replace.replace(query, files, path === undefined);
  }

  #typed(): void {
    clearTimeout(this.#typing);
    this.#typing = setTimeout(() => this.#search(), TYPING_PAUSE);
  }

  #toggle(button: HTMLButtonElement): void {
    button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
    this.#search();
  }

  #visibilityChanged(): void {
    if (this.options.view.visible) {
      // in a moment: whoever showed the panel may be about to search anyway (find)
      if (this.#stale) this.#typing = setTimeout(() => this.#search(true));
    } else if (this.#results) {
      this.#drop();
      this.#stale = true;
    }
  }

  /**
   * Stops the previous search and starts one for the field, the options and the scope (none for an empty or invalid
   * query); `again`: the same search once more, keeping what was expanded and focused. While the panel is hidden, it
   * only notes to search when it is shown.
   */
  #search(again = false): void {
    clearTimeout(this.#typing);
    this.#drop();
    this.#stale = !this.options.view.visible;
    if (!again) {
      this.#expanded.clear();
      this.#current = null;
    }
    if (this.#stale) return;
    const pressed = (name: ToggleName) => this.#toggles[name].getAttribute('aria-pressed') === 'true';
    const query = new TextQuery({ pattern: this.#input.value, isCaseSensitive: pressed('isCaseSensitive'), isWordMatch: pressed('isWordMatch'), isRegExp: pressed('isRegExp') });
    this.#query = query;
    this.#error = query.error;
    if (query.pattern && !query.error) {
      const results = (this.#results = this.options.search(query, this.#scope.scope));
      this.#listener = results.onDidChange(() => this.#scheduleRender());
      this.#searching = true;
      void results.searched.then(() => {
        if (this.#results !== results) return;
        this.#searching = false;
        this.#render();
      });
    }
    this.#render();
  }

  /** Stops the search and forgets its results. */
  #drop(): void {
    clearTimeout(this.#redraw);
    this.#redraw = undefined;
    this.#listener?.dispose();
    this.#results?.dispose();
    this.#listener = this.#results = null;
    this.options.highlights.show(null, null);
  }

  #scheduleRender(): void {
    this.#redraw ??= setTimeout(() => {
      this.#redraw = undefined;
      this.#render();
    }, REDRAW_PAUSE);
  }

  #render(): void {
    const results = this.#results;
    const focused = this.#tree.contains(this.#root.ownerDocument.activeElement);
    const files = results?.files() ?? [];
    this.#empty.hidden = this.#input.value !== '';
    this.#message.textContent = this.#summary(files.length);
    this.#message.classList.toggle('zwf-search__message--error', !!this.#error);
    this.#replaceAll.hidden = this.#mode !== 'replace';
    this.#replaceAll.disabled = !files.length;
    this.#rows = files.flatMap((file) => this.#fileRows(file));
    this.#tree.replaceChildren(...this.#rows.map((row) => row.element));
    const current = this.#rows.find((row) => row.key === this.#current) ?? this.#rows.find((row) => row.key === fileKey(this.#current)) ?? this.#rows[0];
    this.#current = current?.key ?? null;
    this.#highlight();
    if (!current) return;
    current.element.tabIndex = 0;
    if (focused) current.element.focus();
  }

  /** Has the editors highlight the matches listed, the one of the current row emphasised. */
  #highlight(): void {
    const row = this.#rows.find((candidate) => candidate.key === this.#current);
    this.options.highlights.show(this.#results, row?.match ? { path: row.path, match: row.match } : null);
  }

  /** What the search found, in words ("23 results in 4 files"); empty while there is no query. */
  #summary(files: number): string {
    const results = this.#results;
    if (this.#error) return `Invalid regular expression: ${this.#error}`;
    if (!results) return '';
    if (results.limitHit) return `Too many results — narrow the search (the first ${results.count} are shown)`;
    if (results.count === 0) return this.#searching ? 'Searching…' : 'No results';
    return `${plural(results.count, 'result')} in ${plural(files, 'file')}`;
  }

  /** The row of `file` and, while it is expanded, those of its matches (in Replace mode with their replacements). */
  #fileRows(file: FileMatches): Row[] {
    const { path, matches } = file;
    const doc = this.#root.ownerDocument;
    const replacing = this.#mode === 'replace';
    const expanded = this.#expanded.get(path) ?? matches.length <= AUTO_COLLAPSE;
    const item = treeItem(doc, 1, 'zwf-search__file');
    item.setAttribute('aria-expanded', String(expanded));
    const slash = path.lastIndexOf('/');
    item.append(
      element(doc, 'span', 'zwf-search__chevron'),
      element(doc, 'span', 'zwf-search__name', ProjectPath.name(path)),
      element(doc, 'span', 'zwf-search__folder', slash > 0 ? ProjectPath.displayName(path.slice(0, slash) as ProjectPath) : ''),
      element(doc, 'span', 'zwf-search__count', String(matches.length)),
    );
    if (replacing) item.append(rowAction(doc, 'Replace', `Replace all in ${ProjectPath.name(path)} (${keyLabel(REPLACE_ROW_KEY)})`));
    const rows: Row[] = [{ key: `file:${path}`, element: item, path }];
    if (!expanded) return rows;
    const replacements = replacing ? this.#results!.replacements(file, this.#replace.text) : [];
    this.#results!.preview(file).forEach((preview, index) => {
      const match = matches[index];
      const row = matchItem(doc, preview, replacing ? (replacements[index] ?? null) : undefined);
      rows.push({ key: `match:${path}:${match.from}`, element: row, path, match });
    });
    return rows;
  }

  /** In Replace mode: ⌥⌘↩ / Ctrl+Alt+Enter replaces all; ⇧⌘1 / Ctrl+Shift+1 the match or file of the row it is on. */
  #rootKeydown(event: KeyboardEvent): void {
    const key = this.#mode === 'replace' ? replaceKey(event) : null;
    const row = this.#rows[this.#indexOf(event.target)];
    if (key === 'all') this.#replaceMatches();
    else if (key === 'row' && row) this.#replaceMatches(row.path, row.match);
    else return;
    event.preventDefault();
  }

  #inputKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') this.#search();
    else if (event.key === 'ArrowDown' && this.#rows.length) this.#focus(this.#rows.findIndex((row) => row.key === this.#current));
    else return;
    event.preventDefault();
  }

  #click(event: MouseEvent): void {
    const index = this.#indexOf(event.target);
    if (index < 0) return;
    this.#focus(index);
    const row = this.#rows[index];
    if (event.target instanceof Element && event.target.closest('.zwf-search__row-action')) this.#replaceMatches(row.path, row.match);
    else this.#activate(row);
  }

  #treeKeydown(event: KeyboardEvent): void {
    const index = this.#indexOf(event.target);
    if (index < 0) return;
    const row = this.#rows[index];
    const expanded = row.element.getAttribute('aria-expanded');
    const moves: Record<string, number> = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: this.#rows.length - 1 };
    if (event.key in moves) this.#focus(Math.min(Math.max(moves[event.key], 0), this.#rows.length - 1));
    else if (event.key === 'Enter') this.#activate(row);
    else if (event.key === 'ArrowRight' && expanded === 'false') this.#setExpanded(row.path, true);
    else if (event.key === 'ArrowLeft' && expanded === 'true') this.#setExpanded(row.path, false);
    else if (event.key === 'ArrowLeft' && row.match) this.#focus(this.#rows.findIndex((other) => other.key === `file:${row.path}`));
    else return;
    event.preventDefault();
  }

  /** A match opens; a file expands or collapses. */
  #activate(row: Row): void {
    if (row.match) this.options.open(row.path, row.match);
    else this.#setExpanded(row.path, row.element.getAttribute('aria-expanded') !== 'true');
  }

  #setExpanded(path: ProjectPath, expanded: boolean): void {
    this.#expanded.set(path, expanded);
    this.#current = `file:${path}`;
    this.#render();
  }

  /** Makes row `index` the tab stop and focuses it. */
  #focus(index: number): void {
    const row = this.#rows[index];
    if (!row) return;
    for (const other of this.#rows) other.element.tabIndex = other === row ? 0 : -1;
    this.#current = row.key;
    row.element.focus();
    this.#highlight();
  }

  #indexOf(target: EventTarget | null): number {
    const item = target instanceof Element ? target.closest('[role=treeitem]') : null;
    return this.#rows.findIndex((row) => row.element === item);
  }
}

export interface SearchPanelOptions extends ReplaceControlsOptions {
  /** Starts searching for `query` in `scope`; the panel disposes the results with the next search. */
  search(query: TextQuery, scope: SearchScope): SearchResults;
  /** The side panel it is in: it searches only while that is shown. */
  readonly view: Pick<SidePanel, 'visible' | 'onDidChangeVisibility'>;
  /** The file shown in the editing area: the current file to search in. */
  readonly window: Pick<WindowApi, 'activeFile' | 'onDidChangeActiveFile'>;
  /** Where the editors highlight the matches listed (`show`ed after every redraw). */
  readonly highlights: Pick<MatchHighlights, 'show'>;
  /** Shows `match` of file `path` (a click or Enter on its row). */
  open(path: ProjectPath, match: TextMatch): void;
  /** What the panel shows while there is no query: the ways here and their keys ("Find in files", "⌘⇧F"). */
  readonly keys: readonly { readonly label: string; readonly key: string }[];
  /** Where it remembers the mode across visits. */
  readonly state: Pick<Memento, 'get' | 'update'>;
}

/** Find (the default), or Replace: the replace field, the replacements shown, the buttons to replace. */
export type Mode = 'find' | 'replace';

/** What to search for: the arguments of `workbench.action.findInFiles` (VS Code's names); unset: as the panel has it. */
export interface FindOptions {
  readonly query?: string;
  readonly replace?: string;
  readonly isRegex?: boolean;
  readonly isCaseSensitive?: boolean;
  readonly matchWholeWord?: boolean;
}

/** A row of the tree: a file (`match` undefined) or one of its matches. */
interface Row {
  /** Stays the same across redraws while the row's file and match do, to keep the focus on it. */
  readonly key: string;
  readonly element: HTMLElement;
  readonly path: ProjectPath;
  readonly match?: TextMatch;
}

const MODES = ['find', 'replace'] as const;
const TOGGLES = ['isCaseSensitive', 'isWordMatch', 'isRegExp'] as const;
type ToggleName = (typeof TOGGLES)[number];

/** Wait this long (ms) after the last key typed before searching. */
const TYPING_PAUSE = 150;
/** Redraw changed results at most this often (ms): a file changes with every key typed into it. */
const REDRAW_PAUSE = 100;
/** A file with more matches than this starts collapsed. */
const AUTO_COLLAPSE = 10;
/** Replace all, anywhere in the panel (VS Code's and IntelliJ's). */
const REPLACE_ALL_KEY = 'Mod+Alt+Enter';
/** Replace the match or file of the row the tree is on (VS Code's). */
const REPLACE_ROW_KEY = 'Mod+Shift+Digit1';

/** The key of the file row of the match row `key` (itself for a file row). */
function fileKey(key: string | null): string | null {
  return key?.replace(/^match:(.*):\d+$/, 'file:$1') ?? null;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function toggle(doc: Document, text: string, label: string): HTMLButtonElement {
  const button = element(doc, 'button', 'zwf-search__toggle', text);
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', 'false');
  return button;
}

/** Which replace key `event` is: Replace all (⌥⌘↩), the row's (⇧⌘1), or none. */
function replaceKey(event: KeyboardEvent): 'all' | 'row' | null {
  if (!(event.metaKey || event.ctrlKey)) return null;
  if (event.key === 'Enter' && event.altKey && !event.shiftKey) return 'all';
  return event.code === 'Digit1' && event.shiftKey && !event.altKey ? 'row' : null;
}

function modeButton(doc: Document, label: string): HTMLButtonElement {
  const button = element(doc, 'button', 'zwf-search__mode', label);
  button.type = 'button';
  button.title = `${label} in files`;
  return button;
}

/** A row's replace button: not a tab stop of its own (the tree is one; ⇧⌘1 does the same on the row). */
function rowAction(doc: Document, text: string, label: string): HTMLButtonElement {
  const button = element(doc, 'button', 'zwf-search__row-action', text);
  button.type = 'button';
  button.tabIndex = -1;
  button.title = label;
  button.setAttribute('aria-label', label);
  return button;
}

function treeItem(doc: Document, level: number, className: string): HTMLElement {
  const item = element(doc, 'li', className);
  item.setAttribute('role', 'treeitem');
  item.setAttribute('aria-level', String(level));
  item.tabIndex = -1;
  return item;
}

/**
 * A match's row: its line number and the line cut around it (wrapped to a few rows by the styles), the match marked;
 * with a `replacement` the match struck through and the replacement after it (null: the match is no longer there,
 * nothing to show for it), and its replace button.
 */
function matchItem(doc: Document, { line, text, match }: MatchPreview, replacement?: string | null): HTMLElement {
  const item = treeItem(doc, 2, 'zwf-search__match');
  const [from, to] = match;
  const preview = element(doc, 'span', 'zwf-search__preview');
  const hit = text.slice(from, to);
  const marked = typeof replacement === 'string' ? [element(doc, 'del', 'zwf-search__old', hit), element(doc, 'ins', 'zwf-search__new', replacement.replace(/\n/g, '↵'))] : [element(doc, 'mark', 'zwf-search__hit', hit)];
  preview.append(text.slice(0, from), ...marked, text.slice(to));
  item.append(element(doc, 'span', 'zwf-search__line', String(line)), preview);
  if (replacement !== undefined) item.append(rowAction(doc, '⇄', `Replace (${keyLabel(REPLACE_ROW_KEY)})`));
  return item;
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, content?: string): HTMLElementTagNameMap[K] {
  const result = doc.createElement(tag);
  result.className = className;
  if (content !== undefined) result.textContent = content;
  return result;
}
