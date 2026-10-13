// The "Find in files" panel's view. See search in ../search.ts.
import type { Disposable } from '../../../core/disposable/disposable';
import { ProjectPath } from '../../../core/paths/paths';
import type { FileMatches, SearchResults } from '../model/search-results';
import { type TextMatch, TextQuery } from '../model/text-query';

/**
 * The query field with its three options (Match Case, Match Whole Word, Use Regular Expression), what the search found
 * in words ("23 results in 4 files", an invalid regular expression, too many results), and the matches as a tree: a
 * row per file (name, folder, count) with a row per match below (line number, the source line cut around the match,
 * the match marked). Files with many matches start collapsed (VS Code's `search.collapseResults: auto`), and only an
 * expanded file's rows are made. With no query it shows the keys that lead here instead.
 *
 * Typing searches after a short pause, the previous search stopped; the options and Enter search at once. Results
 * follow the files' changes, redrawn at most every few milliseconds. The tree is one tab stop (↑ / ↓, Home / End,
 * ← / → collapse and expand; ↓ from the field enters it); a click or Enter on a match opens it.
 */
export class SearchPanel {
  readonly #root: HTMLElement;
  readonly #input: HTMLInputElement;
  readonly #toggles: Record<ToggleName, HTMLButtonElement>;
  readonly #message: HTMLElement;
  readonly #empty: HTMLElement;
  readonly #tree: HTMLElement;
  #results: SearchResults | null = null;
  #listener: Disposable | null = null;
  #error: string | undefined;
  /** Whether `#results` are still being searched for. */
  #searching = false;
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
    this.#root = element(doc, 'div', 'typst-search');
    this.#root.dataset.testid = 'typst-search';
    const field = element(doc, 'div', 'typst-search__field');
    this.#input = field.appendChild(element(doc, 'input', 'typst-search__input'));
    this.#input.type = 'text';
    this.#input.placeholder = 'Find';
    this.#input.setAttribute('aria-label', 'Find');
    this.#input.spellcheck = false;
    this.#toggles = {
      isCaseSensitive: field.appendChild(toggle(doc, 'Aa', 'Match Case')),
      isWordMatch: field.appendChild(toggle(doc, 'ab', 'Match Whole Word')),
      isRegExp: field.appendChild(toggle(doc, '.*', 'Use Regular Expression')),
    };
    this.#message = element(doc, 'p', 'typst-search__message');
    this.#message.setAttribute('role', 'status');
    this.#empty = element(doc, 'dl', 'typst-search__empty');
    for (const { label, key } of options.keys) this.#empty.append(element(doc, 'dt', 'typst-search__empty-label', label), element(doc, 'dd', 'typst-search__empty-key', key));
    this.#tree = element(doc, 'ul', 'typst-search__tree');
    this.#tree.setAttribute('role', 'tree');
    this.#tree.setAttribute('aria-label', 'Results');
    this.#root.append(field, this.#message, this.#empty, this.#tree);
    parent.append(this.#root);
    this.#input.addEventListener('input', () => this.#typed());
    this.#input.addEventListener('keydown', (event) => this.#inputKeydown(event));
    for (const button of Object.values(this.#toggles)) button.addEventListener('click', () => this.#toggle(button));
    this.#tree.addEventListener('click', (event) => this.#click(event));
    this.#tree.addEventListener('keydown', (event) => this.#treeKeydown(event));
    this.#render();
  }

  /**
   * Searches for what `options` sets (the rest as it is) right away, and focuses the query field with its text
   * selected, to type over.
   */
  find(options: FindOptions = {}): void {
    if (options.query !== undefined) this.#input.value = options.query;
    const set: Record<ToggleName, boolean | undefined> = { isCaseSensitive: options.isCaseSensitive, isWordMatch: options.matchWholeWord, isRegExp: options.isRegex };
    for (const name of TOGGLES) if (set[name] !== undefined) this.#toggles[name].setAttribute('aria-pressed', String(set[name]));
    this.#search();
    this.#input.focus();
    this.#input.select();
  }

  dispose(): void {
    clearTimeout(this.#typing);
    clearTimeout(this.#redraw);
    this.#listener?.dispose();
    this.#results?.dispose();
    this.#root.remove();
  }

  #typed(): void {
    clearTimeout(this.#typing);
    this.#typing = setTimeout(() => this.#search(), TYPING_PAUSE);
  }

  #toggle(button: HTMLButtonElement): void {
    button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
    this.#search();
  }

  /** Stops the previous search and starts one for the field and the options (none for an empty or invalid query). */
  #search(): void {
    clearTimeout(this.#typing);
    this.#listener?.dispose();
    this.#results?.dispose();
    this.#listener = this.#results = null;
    this.#expanded.clear();
    this.#current = null;
    const pressed = (name: ToggleName) => this.#toggles[name].getAttribute('aria-pressed') === 'true';
    const query = new TextQuery({ pattern: this.#input.value, isCaseSensitive: pressed('isCaseSensitive'), isWordMatch: pressed('isWordMatch'), isRegExp: pressed('isRegExp') });
    this.#error = query.error;
    if (query.pattern && !query.error) {
      const results = (this.#results = this.options.search(query));
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
    this.#message.classList.toggle('typst-search__message--error', !!this.#error);
    this.#rows = files.flatMap((file) => this.#fileRows(file));
    this.#tree.replaceChildren(...this.#rows.map((row) => row.element));
    const current = this.#rows.find((row) => row.key === this.#current) ?? this.#rows.find((row) => row.key === fileKey(this.#current)) ?? this.#rows[0];
    this.#current = current?.key ?? null;
    if (!current) return;
    current.element.tabIndex = 0;
    if (focused) current.element.focus();
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

  /** The row of `file` and, while it is expanded, those of its matches. */
  #fileRows({ path, matches }: FileMatches): Row[] {
    const doc = this.#root.ownerDocument;
    const expanded = this.#expanded.get(path) ?? matches.length <= AUTO_COLLAPSE;
    const item = treeItem(doc, 1, 'typst-search__file');
    item.setAttribute('aria-expanded', String(expanded));
    const slash = path.lastIndexOf('/');
    item.append(
      element(doc, 'span', 'typst-search__chevron'),
      element(doc, 'span', 'typst-search__name', ProjectPath.name(path)),
      element(doc, 'span', 'typst-search__folder', slash > 0 ? ProjectPath.displayName(path.slice(0, slash) as ProjectPath) : ''),
      element(doc, 'span', 'typst-search__count', String(matches.length)),
    );
    const rows: Row[] = [{ key: `file:${path}`, element: item, path }];
    if (expanded) for (const match of matches) rows.push({ key: `match:${path}:${match.from}`, element: matchItem(doc, match), path, match });
    return rows;
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
    this.#activate(this.#rows[index]);
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
  }

  #indexOf(target: EventTarget | null): number {
    const item = target instanceof Element ? target.closest('[role=treeitem]') : null;
    return this.#rows.findIndex((row) => row.element === item);
  }
}

export interface SearchPanelOptions {
  /** Starts searching for `query` (in the scope searched); the panel disposes the results with the next search. */
  search(query: TextQuery): SearchResults;
  /** Shows `match` of file `path` (a click or Enter on its row). */
  open(path: ProjectPath, match: TextMatch): void;
  /** What the panel shows while there is no query: the ways here and their keys ("Find in files", "⌘⇧F"). */
  readonly keys: readonly { readonly label: string; readonly key: string }[];
}

/** What to search for: the arguments of `workbench.action.findInFiles` (VS Code's names); unset: as the panel has it. */
export interface FindOptions {
  readonly query?: string;
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

const TOGGLES = ['isCaseSensitive', 'isWordMatch', 'isRegExp'] as const;
type ToggleName = (typeof TOGGLES)[number];

/** Wait this long (ms) after the last key typed before searching. */
const TYPING_PAUSE = 150;
/** Redraw changed results at most this often (ms): a file changes with every key typed into it. */
const REDRAW_PAUSE = 100;
/** A file with more matches than this starts collapsed. */
const AUTO_COLLAPSE = 10;

/** The key of the file row of the match row `key` (itself for a file row). */
function fileKey(key: string | null): string | null {
  return key?.replace(/^match:(.*):\d+$/, 'file:$1') ?? null;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function toggle(doc: Document, text: string, label: string): HTMLButtonElement {
  const button = element(doc, 'button', 'typst-search__toggle', text);
  button.type = 'button';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', 'false');
  return button;
}

function treeItem(doc: Document, level: number, className: string): HTMLElement {
  const item = element(doc, 'li', className);
  item.setAttribute('role', 'treeitem');
  item.setAttribute('aria-level', String(level));
  item.tabIndex = -1;
  return item;
}

/** A match's row: its line number and the line cut around it, the match marked. */
function matchItem(doc: Document, { line, preview }: TextMatch): HTMLElement {
  const item = treeItem(doc, 2, 'typst-search__match');
  const [from, to] = preview.match;
  const text = element(doc, 'span', 'typst-search__preview');
  text.append(preview.text.slice(0, from), element(doc, 'mark', 'typst-search__hit', preview.text.slice(from, to)), preview.text.slice(to));
  item.append(element(doc, 'span', 'typst-search__line', String(line)), text);
  return item;
}

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, content?: string): HTMLElementTagNameMap[K] {
  const result = doc.createElement(tag);
  result.className = className;
  if (content !== undefined) result.textContent = content;
  return result;
}
