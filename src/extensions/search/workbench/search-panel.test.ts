// @vitest-environment jsdom
// Tests for search-panel.ts with the real model over a project: the keys while there is no query; the result tree
// (files, lines, the match marked, collapsed files); typing, the options, an invalid regular expression, too many
// results; the keyboard and clicks; results following a file's change; the scopes (project, current file, folder);
// a hidden panel dropping its results and searching again when shown; what it has the editors highlight; Replace
// mode (the mode remembered, the preview, replacing a match, a file or all, confirmation, Undo, a match changed
// meanwhile).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../../core/paths/paths';
import { Project, type ProjectFiles } from '../../../core/project/project';
import { SourceRange } from '../../../core/typst-document/typst-document';
import { Replacement } from '../model/replace';
import { SearchResults } from '../model/search-results';
import type { TextMatch } from '../model/text-query';
import { SearchPanel } from './search-panel';

const path = ProjectPath.of;

beforeEach(() => void vi.useFakeTimers());

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

const FILES: ProjectFiles = { '/main.typ': 'Hello world\nhello again\n', '/chapters/intro.typ': 'Say hello.\n', '/refs.bib': '@book{hello}', '/logo.png': new Uint8Array() };

function setup(files: ProjectFiles = FILES, state: Record<string, unknown> = {}) {
  const project = new Project(path('/main.typ'), files);
  const opened: [ProjectPath, TextMatch][] = [];
  /** What the panel last had the editors highlight: the files' match counts, the current match as `path:from`. */
  let highlighted = { files: [] as string[], current: '' };
  const searches: SearchResults[] = [];
  const visibility = new EventEmitter<void>();
  const view = { visible: true, onDidChangeVisibility: visibility.event };
  const activeFile = new EventEmitter<ProjectPath>();
  const stored = new Map<string, unknown>(Object.entries(state));
  const confirmed: string[] = [];
  let confirm = true;
  const window = { activeFile: path('/main.typ'), onDidChangeActiveFile: activeFile.event };
  const panel = new SearchPanel(document.body, {
    search: (query, scope) => {
      const results = new SearchResults({ project, query, scope, isTextFile: (file) => file.endsWith('.bib') });
      searches.push(results);
      return results;
    },
    open: (file, match) => opened.push([file, match]),
    view,
    window,
    highlights: {
      show: (results, current) => {
        highlighted = { files: (results?.files() ?? []).map((file) => `${file.path} ${file.matches.length}`), current: current ? `${current.path}:${current.match.from}` : '' };
      },
    },
    keys: [{ label: 'Find in files', key: 'Ctrl+Shift+F' }],
    replace: (query, matches, replace) => Replacement.apply({ project, applyEdit: async (change) => (project.apply(change), null) }, query, matches, replace),
    confirm: async (message) => (confirmed.push(message), confirm),
    state: { get: ((key: string, fallback?: unknown) => stored.get(key) ?? fallback) as never, update: async (key, value) => void stored.set(key, value) },
  });
  const root = document.querySelector<HTMLElement>('[data-testid=typst-search]')!;
  const input = root.querySelector('input')!;
  const rows = () => [...root.querySelectorAll<HTMLElement>('[role=treeitem]')];
  const toggle = (label: string) => root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  return {
    project,
    panel,
    stored,
    confirmed,
    /** Whether the confirmation is answered with yes. */
    setConfirm: (answer: boolean) => void (confirm = answer),
    /** The first button whose title or text starts with `label`. */
    button: (label: string) => [...root.querySelectorAll('button')].find((button) => button.title.startsWith(label) || button.textContent!.startsWith(label))!,
    replaceInput: () => root.querySelector<HTMLInputElement>('input[aria-label=Replace]')!,
    notice: () => {
      const notice = root.querySelector<HTMLElement>('.typst-search__notice')!;
      return notice.hidden ? '' : notice.firstElementChild!.textContent;
    },
    searches,
    /** Shows or hides the panel. */
    setVisible: (visible: boolean) => {
      view.visible = visible;
      visibility.fire();
    },
    /** Shows `file` in the editing area. */
    show: (file: string) => {
      window.activeFile = path(file);
      activeFile.fire(path(file));
    },
    scope: () => root.querySelector<HTMLSelectElement>('select')!,
    /** What the scope line says beside the choice: the current file, or the folder chip. */
    scopeTarget: () => {
      const target = root.querySelector<HTMLElement>('.typst-search__scope-target')!;
      return target.hidden ? '' : target.firstElementChild!.textContent;
    },
    clearScope: () => root.querySelector<HTMLButtonElement>('button[aria-label="Search the whole project"]')!,
    opened,
    highlighted: () => highlighted,
    input,
    rows,
    toggle,
    message: () => root.querySelector('[role=status]')!.textContent,
    /** The rows as text: a file row `name folder (count)`, a match row `line: preview` with the match in [ ]. */
    tree: () => rows().map((row) => (row.getAttribute('aria-level') === '1' ? fileRow(row) : matchRow(row))),
    empty: () => root.querySelector<HTMLElement>('dl')!,
    type: async (text: string) => {
      input.value = text;
      input.dispatchEvent(new Event('input'));
      await vi.runAllTimersAsync();
    },
    press: (target: HTMLElement, key: string) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })),
  };
}

function fileRow(row: HTMLElement): string {
  const [, name, folder, count] = [...row.children].map((part) => part.textContent);
  return `${row.getAttribute('aria-expanded') === 'true' ? '▾' : '▸'} ${name} ${folder} (${count})`.replace('  ', ' ');
}

function matchRow(row: HTMLElement): string {
  const [line, preview] = row.children;
  const marks: Record<string, string> = { MARK: '[$]', DEL: '~$~', INS: '{$}' };
  return `  ${line.textContent}: ${[...preview.childNodes].map((node) => marks[node.nodeName]?.replace('$', node.textContent!) ?? node.textContent).join('')}`;
}

describe('SearchPanel', () => {
  it('shows the keys that lead here while there is no query', () => {
    const { empty, rows, message } = setup();
    expect(empty().hidden).toBe(false);
    expect(empty().textContent).toBe('Find in filesCtrl+Shift+F');
    expect(rows()).toEqual([]);
    expect(message()).toBe('');
  });

  it('find() searches at once and lists the matches by file: line number, the line, the match marked', async () => {
    const { panel, input, tree, message, empty } = setup();
    panel.find({ query: 'hello' });
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
    await vi.runAllTimersAsync();
    expect(empty().hidden).toBe(true);
    expect(message()).toBe('4 results in 3 files');
    expect(tree()).toEqual(['▾ main.typ (2)', '  1: [Hello] world', '  2: [hello] again', '▾ intro.typ chapters (1)', '  1: Say [hello].', '▾ refs.bib (1)', '  1: @book{[hello]}']);
  });

  it('searches after a pause in typing, and again at once for each option', async () => {
    const { type, toggle, tree, message, input } = setup();
    input.value = 'hello';
    input.dispatchEvent(new Event('input'));
    expect(tree()).toEqual([]);
    await vi.runAllTimersAsync();
    expect(message()).toBe('4 results in 3 files');
    toggle('Match Case').click();
    await vi.runAllTimersAsync();
    expect(toggle('Match Case').getAttribute('aria-pressed')).toBe('true');
    expect(message()).toBe('3 results in 3 files');
    await type('hell');
    toggle('Match Whole Word').click();
    await vi.runAllTimersAsync();
    expect(message()).toBe('No results');
    toggle('Match Whole Word').click();
    toggle('Use Regular Expression').click();
    await type('w.rld|again');
    expect(tree()).toEqual(['▾ main.typ (2)', '  1: Hello [world]', '  2: hello [again]']);
  });

  it('has the editors highlight what it lists, the match row the tree is on as the current one; nothing while hidden', async () => {
    const { panel, rows, press, highlighted, setVisible } = setup();
    panel.find({ query: 'hello' });
    await vi.runAllTimersAsync();
    expect(highlighted()).toEqual({ files: ['/main.typ 2', '/chapters/intro.typ 1', '/refs.bib 1'], current: '' });
    rows()[0].focus();
    press(rows()[0], 'ArrowDown');
    press(rows()[1], 'ArrowDown');
    expect(highlighted().current).toBe('/main.typ:12');
    setVisible(false);
    expect(highlighted()).toEqual({ files: [], current: '' });
  });

  it('says what is wrong with an invalid regular expression, and lists nothing', async () => {
    const { panel, tree, message } = setup();
    panel.find({ query: 'hel(', isRegex: true });
    await vi.runAllTimersAsync();
    expect(message()).toMatch(/^Invalid regular expression: .*group/);
    expect(tree()).toEqual([]);
  });

  it('a file with many matches starts collapsed; a click, Enter and ← / → collapse and expand', async () => {
    const { panel, rows, tree, press } = setup({ '/main.typ': 'x\n'.repeat(11), '/b.typ': 'x' });
    panel.find({ query: 'x' });
    await vi.runAllTimersAsync();
    expect(tree()).toEqual(['▸ main.typ (11)', '▾ b.typ (1)', '  1: [x]']);
    rows()[0].click();
    expect(tree()).toHaveLength(14);
    expect(document.activeElement).toBe(rows()[0]);
    press(rows()[0], 'ArrowLeft');
    expect(tree()[0]).toBe('▸ main.typ (11)');
    press(rows()[0], 'ArrowRight');
    expect(tree()[0]).toBe('▾ main.typ (11)');
    press(rows()[0], 'Enter');
    expect(tree()).toEqual(['▸ main.typ (11)', '▾ b.typ (1)', '  1: [x]']);
  });

  it('is one tab stop: ↓ from the field enters it, ↑ / ↓ / Home / End move, ← goes to the file; Enter or a click opens a match', async () => {
    const { panel, input, rows, press, opened } = setup();
    panel.find({ query: 'hello' });
    await vi.runAllTimersAsync();
    expect(rows().map((row) => row.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1]);
    press(input, 'ArrowDown');
    expect(document.activeElement).toBe(rows()[0]);
    press(rows()[0], 'ArrowDown');
    press(rows()[1], 'ArrowDown');
    expect(document.activeElement).toBe(rows()[2]);
    expect(rows().map((row) => row.tabIndex)).toEqual([-1, -1, 0, -1, -1, -1, -1]);
    press(rows()[2], 'Enter');
    expect(opened).toEqual([[path('/main.typ'), expect.objectContaining({ ...SourceRange.of({ from: 12, to: 17 }), line: 2 })]]);
    press(rows()[2], 'ArrowLeft');
    expect(document.activeElement).toBe(rows()[0]);
    press(rows()[0], 'End');
    expect(document.activeElement).toBe(rows()[6]);
    rows()[4].click();
    expect(opened[1]).toEqual([path('/chapters/intro.typ'), expect.objectContaining({ from: 4, to: 9 })]);
  });

  it('follows a file changed, keeping the focus on its file when the focused match moved', async () => {
    const { project, panel, rows, tree, message, press, input } = setup();
    panel.find({ query: 'hello' });
    await vi.runAllTimersAsync();
    press(input, 'ArrowDown');
    press(rows()[0], 'ArrowDown');
    project.document(path('/main.typ'))!.change([{ ...SourceRange.of({ from: 0, to: 0 }), insert: 'Oh, ' }, { ...SourceRange.of({ from: 12, to: 12 }), insert: 'hello ' }], 'test');
    await vi.runAllTimersAsync();
    expect(message()).toBe('5 results in 3 files');
    expect(tree().slice(0, 4)).toEqual(['▾ main.typ (3)', '  1: Oh, [Hello] world', '  2: [hello] hello again', '  2: hello [hello] again']);
    expect(document.activeElement).toBe(rows()[0]);
  });

  it('says when there are too many results', async () => {
    const { panel, message } = setup({ '/main.typ': 'x\n'.repeat(5001) });
    panel.find({ query: 'x' });
    await vi.runAllTimersAsync();
    expect(message()).toBe('Too many results — narrow the search (the first 5000 are shown)');
  });

  it('searches the current file, following the file shown', async () => {
    const { panel, scope, scopeTarget, tree, show } = setup();
    panel.find({ query: 'hello' });
    scope().value = 'file';
    scope().dispatchEvent(new Event('change'));
    await vi.runAllTimersAsync();
    expect(scopeTarget()).toBe('main.typ');
    expect(tree()).toEqual(['▾ main.typ (2)', '  1: [Hello] world', '  2: [hello] again']);
    show('/chapters/intro.typ');
    await vi.runAllTimersAsync();
    expect(scopeTarget()).toBe('chapters/intro.typ');
    expect(tree()).toEqual(['▾ intro.typ chapters (1)', '  1: Say [hello].']);
  });

  it('searches a folder with its subfolders: picked, or the current file\'s; × goes back to the project', async () => {
    const files = { '/main.typ': 'hello', '/a/one.typ': 'hello', '/a/b/two.typ': 'hello', '/ab.typ': 'hello' };
    const { panel, scope, scopeTarget, tree, message, show, clearScope } = setup(files);
    panel.find({ query: 'hello' }, { scope: { kind: 'folder', path: path('/a') } });
    await vi.runAllTimersAsync();
    expect(scope().value).toBe('folder');
    expect(scopeTarget()).toBe('a/');
    expect(tree()).toEqual(['▾ two.typ a/b (1)', '  1: [hello]', '▾ one.typ a (1)', '  1: [hello]']);
    show('/a/b/two.typ');
    scope().value = 'folder';
    scope().dispatchEvent(new Event('change'));
    await vi.runAllTimersAsync();
    expect(scopeTarget()).toBe('a/b/');
    expect(message()).toBe('1 result in 1 file');
    clearScope().click();
    await vi.runAllTimersAsync();
    expect([scope().value, scopeTarget()]).toEqual(['project', '']);
    expect(message()).toBe('4 results in 4 files');
    show('/main.typ');
    scope().value = 'folder';
    scope().dispatchEvent(new Event('change'));
    expect(scope().value).toBe('project');
  });

  it('hidden, drops its results; shown, searches again keeping what was expanded', async () => {
    const { project, panel, searches, setVisible, rows, tree } = setup({ '/main.typ': 'x\n'.repeat(11), '/b.typ': 'x' });
    panel.find({ query: 'x' });
    await vi.runAllTimersAsync();
    rows()[0].click();
    setVisible(false);
    expect(searches).toHaveLength(1);
    project.document(path('/b.typ'))!.change([{ ...SourceRange.of({ from: 1, to: 1 }), insert: ' x' }], 'test');
    await vi.runAllTimersAsync();
    expect(tree()).toHaveLength(14);
    setVisible(true);
    await vi.runAllTimersAsync();
    expect(searches).toHaveLength(2);
    expect(tree()).toHaveLength(15);
    expect(tree().slice(-3)).toEqual(['▾ b.typ (2)', '  1: [x] x', '  1: x [x]']);
  });

  it('a search asked for while hidden waits until shown', async () => {
    const { panel, searches, setVisible, message } = setup();
    setVisible(false);
    panel.find({ query: 'hello' });
    expect(searches).toHaveLength(0);
    setVisible(true);
    panel.find();
    await vi.runAllTimersAsync();
    expect(searches).toHaveLength(1);
    expect(message()).toBe('4 results in 3 files');
  });
});

describe('SearchPanel in Replace mode', () => {
  it('switches mode in its header, keeping the query; remembers the mode', async () => {
    const { panel, button, replaceInput, stored, message, root } = { ...setup(), root: () => document.querySelector('[data-testid=typst-search]')! };
    expect(replaceInput().closest<HTMLElement>('[hidden]')).not.toBeNull();
    panel.find({ query: 'hello' });
    await vi.runAllTimersAsync();
    button('Replace in files').click();
    expect(button('Replace in files').getAttribute('aria-pressed')).toBe('true');
    expect(replaceInput().closest('[hidden]')).toBeNull();
    expect(stored.get('mode')).toBe('replace');
    expect(message()).toBe('4 results in 3 files');
    expect(root().querySelector<HTMLElement>('.typst-search__replace-all')!.hidden).toBe(false);
    button('Find in files').click();
    expect(stored.get('mode')).toBe('find');
    document.body.replaceChildren();
    expect(setup(FILES, { mode: 'replace' }).button('Replace in files').getAttribute('aria-pressed')).toBe('true');
  });

  it('shows each match struck through with its replacement, regular expression groups filled in', async () => {
    const { panel, tree, replaceInput } = setup({ '/main.typ': 'ann@example bob@test\n' });
    panel.find({ query: '(\\w+)@(\\w+)', isRegex: true, replace: '$2 for $1' }, { mode: 'replace' });
    await vi.runAllTimersAsync();
    expect(tree()).toEqual(['▾ main.typ (2)', '  1: ~ann@example~{example for ann} bob@test', '  1: ann@example ~bob@test~{test for bob}']);
    replaceInput().value = '$1';
    replaceInput().dispatchEvent(new Event('input'));
    await vi.runAllTimersAsync();
    expect(tree()[1]).toBe('  1: ~ann@example~{ann} bob@test');
  });

  it('replaces a match (its row\'s button, or Ctrl+Shift+1 on its row) or a file\'s matches; Undo puts them back', async () => {
    const { project, panel, rows, tree, notice, button } = setup();
    const text = () => project.content(path('/main.typ'));
    panel.find({ query: 'hello', replace: 'bye' }, { mode: 'replace' });
    await vi.runAllTimersAsync();
    rows()[1].querySelector('button')!.click();
    expect(text()).toBe('bye world\nhello again\n');
    await vi.runAllTimersAsync();
    expect(notice()).toBe('Replaced 1 occurrence in 1 file');
    await vi.runAllTimersAsync();
    expect(tree()[0]).toBe('▾ main.typ (1)');
    rows()[1].focus();
    rows()[1].dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '!', ctrlKey: true, shiftKey: true, bubbles: true }));
    expect(text()).toBe('bye world\nbye again\n');
    await vi.runAllTimersAsync();
    rows()[0].querySelector('button')!.click();
    expect(project.content(path('/chapters/intro.typ'))).toBe('Say bye.\n');
    await vi.runAllTimersAsync();
    expect(notice()).toBe('Replaced 1 occurrence in 1 file');
    button('Undo').click();
    await vi.runAllTimersAsync();
    expect(notice()).toBe('Restored 1 occurrence');
    expect(project.content(path('/chapters/intro.typ'))).toBe('Say hello.\n');
    expect(text()).toBe('bye world\nbye again\n');
  });

  it('Replace all (its button or Ctrl+Alt+Enter) asks first for more than one file; Undo takes it all back', async () => {
    const { project, panel, button, confirmed, setConfirm, notice, input, message } = setup();
    panel.find({ query: 'hello', replace: 'bye' }, { mode: 'replace' });
    await vi.runAllTimersAsync();
    setConfirm(false);
    button('Replace all').click();
    await vi.runAllTimersAsync();
    expect(confirmed).toEqual(['Replace 4 occurrences in 3 files?']);
    expect(project.content(path('/main.typ'))).toBe('Hello world\nhello again\n');
    setConfirm(true);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, altKey: true, bubbles: true, cancelable: true }));
    await vi.runAllTimersAsync();
    expect(project.files()).toMatchObject({ '/main.typ': 'bye world\nbye again\n', '/chapters/intro.typ': 'Say bye.\n', '/refs.bib': '@book{bye}' });
    expect(notice()).toBe('Replaced 4 occurrences in 3 files');
    expect(message()).toBe('No results');
    expect(button('Replace all').disabled).toBe(true);
    project.document(path('/main.typ'))!.change([{ ...SourceRange.of({ from: 0, to: 0 }), insert: 'Oh, ' }, { ...SourceRange.of({ from: 10, to: 13 }), insert: 'Bye' }], 'test');
    button('Undo').click();
    await vi.runAllTimersAsync();
    expect(notice()).toBe('Restored 3 occurrences · 1 replacement edited since, left as they are');
    expect(project.files()).toMatchObject({ '/main.typ': 'Oh, Hello world\nBye again\n', '/chapters/intro.typ': 'Say hello.\n', '/refs.bib': '@book{hello}' });
    expect(button('Undo').hidden).toBe(true);
  });

  it('leaves a match whose text changed since the list was drawn, and says so', async () => {
    const { project, panel, rows, notice } = setup();
    panel.find({ query: 'hello', replace: 'bye' }, { mode: 'replace' });
    await vi.runAllTimersAsync();
    project.document(path('/main.typ'))!.change([{ ...SourceRange.of({ from: 0, to: 0 }), insert: 'Oh, ' }], 'test');
    rows()[1].querySelector('button')!.click();
    await vi.runAllTimersAsync();
    expect(project.content(path('/main.typ'))).toBe('Oh, Hello world\nhello again\n');
    expect(notice()).toBe('Nothing replaced · 1 match changed meanwhile, not replaced');
  });

  it('does not replace in Find mode', async () => {
    const { project, panel, rows } = setup();
    panel.find({ query: 'hello', replace: 'bye' }, { mode: 'find' });
    await vi.runAllTimersAsync();
    expect(rows()[1].querySelector('button')).toBeNull();
    rows()[1].focus();
    rows()[1].dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '!', ctrlKey: true, shiftKey: true, bubbles: true }));
    expect(project.content(path('/main.typ'))).toBe('Hello world\nhello again\n');
  });
});
