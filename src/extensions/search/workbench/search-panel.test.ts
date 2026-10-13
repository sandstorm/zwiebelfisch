// @vitest-environment jsdom
// Tests for search-panel.ts with the real model over a project: the keys while there is no query; the result tree
// (files, lines, the match marked, collapsed files); typing, the options, an invalid regular expression, too many
// results; the keyboard and clicks; results following a file's change; the scopes (project, current file, folder);
// a hidden panel dropping its results and searching again when shown.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../../core/paths/paths';
import { Project, type ProjectFiles } from '../../../core/project/project';
import { SourceRange } from '../../../core/typst-document/typst-document';
import { SearchResults } from '../model/search-results';
import type { TextMatch } from '../model/text-query';
import { SearchPanel } from './search-panel';

const path = ProjectPath.of;

beforeEach(() => void vi.useFakeTimers());

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

function setup(files: ProjectFiles = { '/main.typ': 'Hello world\nhello again\n', '/chapters/intro.typ': 'Say hello.\n', '/refs.bib': '@book{hello}', '/logo.png': new Uint8Array() }) {
  const project = new Project(path('/main.typ'), files);
  const opened: [ProjectPath, TextMatch][] = [];
  const searches: SearchResults[] = [];
  const visibility = new EventEmitter<void>();
  const view = { visible: true, onDidChangeVisibility: visibility.event };
  const activeFile = new EventEmitter<ProjectPath>();
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
    keys: [{ label: 'Find in files', key: 'Ctrl+Shift+F' }],
  });
  const root = document.querySelector<HTMLElement>('[data-testid=typst-search]')!;
  const input = root.querySelector('input')!;
  const rows = () => [...root.querySelectorAll<HTMLElement>('[role=treeitem]')];
  const toggle = (label: string) => root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  return {
    project,
    panel,
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
  return `  ${line.textContent}: ${[...preview.childNodes].map((node) => (node.nodeName === 'MARK' ? `[${node.textContent}]` : node.textContent)).join('')}`;
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
    panel.find({ query: 'hello' }, { kind: 'folder', path: path('/a') });
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
