// @vitest-environment jsdom
// Tests for search.ts in a workbench (preview mocked: no worker in jsdom): the panel on the rail; the key and the
// command, with the selection or the arguments as query; a match opening in the editor shown now (Visual or Source),
// a text file's match opening that file.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import { Project } from '../../core/project/project';
import { SourceRange } from '../../core/typst-document/typst-document';
import { SOURCE_EDITOR } from '../../hosts/source-editor/source-editor';
import { VISUAL_EDITOR } from '../../hosts/visual-editor/visual-editor';
import type { WindowApi } from '../../hosts/window/window';
import { type TypstExtension, WorkbenchHost } from '../../hosts/workbench/workbench';
import { search } from './search';

vi.mock('../../hosts/preview/preview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Preview: class {
    update() {}
    onDidRender = () => new Disposable(() => {});
    dispose() {}
  },
}));

const path = ProjectPath.of;

beforeEach(() => void vi.useFakeTimers());

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  sessionStorage.clear();
});

function setup(viewType?: string) {
  const host = document.body.appendChild(document.createElement('div'));
  const project = new Project(path('/main.typ'), { '/main.typ': 'Hello world\n\nThe world is round.\n', '/notes.txt': 'world notes' });
  const workbench = new WorkbenchHost(host, project, { viewType });
  let window!: WindowApi;
  // a text file: one with a declared language
  const probe: TypstExtension = { id: 'probe', contributes: { languages: [{ id: 'plaintext', extensions: ['.txt'] }] }, activate: (context) => void (window = context.window) };
  workbench.activate([search(), probe]);
  const panel = host.querySelector<HTMLElement>('[data-testid=typst-search]')!;
  const input = panel.querySelector('input')!;
  const row = (text: string) => [...panel.querySelectorAll<HTMLElement>('[role=treeitem]')].find((item) => item.textContent?.includes(text))!;
  return { host, project, workbench, window, panel, input, row };
}

describe('search', () => {
  it('is a left side panel "Find in files", its rail button before search everywhere', () => {
    const { host } = setup();
    const button = host.querySelector<HTMLElement>('[data-testid=typst-panel-toggle-search]')!;
    expect(button.getAttribute('aria-label')).toBe('Find in files');
    expect(button.compareDocumentPosition(host.querySelector('[data-testid=typst-search-everywhere]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('Ctrl+Shift+F shows the panel and searches for the selection of the shown editor', async () => {
    const { host, window, input, row } = setup(SOURCE_EDITOR);
    window.activeTextEditor!.revealRange(SourceRange.of({ from: 6, to: 11 }));
    host.querySelector('.cm-content')!.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'F', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    expect(host.querySelector('[data-testid=typst-panel-toggle-search]')!.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('world');
    await vi.runAllTimersAsync();
    expect(row('notes.txt')).toBeDefined();
  });

  it('workbench.action.findInFiles takes VS Code arguments', async () => {
    const { workbench, panel, input } = setup();
    await workbench.commands.executeCommand('workbench.action.findInFiles', { query: 'w.rld', isRegex: true, isCaseSensitive: true });
    await vi.runAllTimersAsync();
    expect(input.value).toBe('w.rld');
    expect(panel.querySelector('[aria-label="Use Regular Expression"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(panel.querySelector('[role=status]')?.textContent).toBe('3 results in 2 files');
  });

  it('a match opens in the editor shown now, selected: Visual or Source', async () => {
    for (const viewType of [VISUAL_EDITOR, SOURCE_EDITOR]) {
      const { workbench, window, row } = setup(viewType);
      await workbench.commands.executeCommand('workbench.action.findInFiles', { query: 'round' });
      await vi.runAllTimersAsync();
      workbench.open(path('/notes.txt'));
      row('The world is round.').click();
      expect(window.activeFile).toBe('/main.typ');
      expect(window.activeTextEditor?.viewType).toBe(viewType);
      expect(window.activeTextEditor?.selection).toEqual({ from: 26, to: 31 });
      document.body.replaceChildren();
    }
  });

  it('a match in a text file opens that file', async () => {
    const { workbench, window, row } = setup();
    await workbench.commands.executeCommand('workbench.action.findInFiles', { query: 'notes' });
    await vi.runAllTimersAsync();
    row('world notes').click();
    expect(window.activeFile).toBe('/notes.txt');
  });
});
