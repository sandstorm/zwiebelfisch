// @vitest-environment jsdom
// Tests for file-navigation.ts in a workbench: "Back to …" / "Forward to …" above supplementary files, going back with the
// editor and selection the file was left with, the keys, renames and deletions (preview mocked: no worker in jsdom).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import { Project } from '../../core/project/project';
import { SourceRange } from '../../core/typst-document/typst-document';
import { SOURCE_EDITOR } from '../../hosts/source-editor/source-editor';
import { VISUAL_EDITOR } from '../../hosts/visual-editor/visual-editor';
import type { ExtensionContext } from '../../hosts/workbench/workbench';
import { WorkbenchHost } from '../../hosts/workbench/workbench';
import { fileNavigation } from './file-navigation';

vi.mock('../../hosts/preview/preview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Preview: class {
    update() {}
    onDidRender = () => new Disposable(() => {});
    dispose() {}
  },
}));

const path = ProjectPath.of;

afterEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
});

/** main.typ includes chapter.typ; flow.mmd opens in a plain test editor. */
function setup() {
  const host = document.body.appendChild(document.createElement('div'));
  const project = new Project(path('/main.typ'), {
    '/main.typ': '= Main\n#include "chapter.typ"\n',
    '/chapter.typ': '= Chapter\nSome text.\n',
    '/flow.mmd': 'graph TD\n',
  });
  const workbench = new WorkbenchHost(host, project, { viewType: SOURCE_EDITOR });
  let context!: ExtensionContext;
  const probe = {
    id: 'probe',
    activate(given: ExtensionContext) {
      context = given;
      given.window.registerCustomEditorProvider(
        'probe.text',
        { resolveCustomEditor: (document, panel) => panel.element.append(Object.assign(host.ownerDocument.createElement('pre'), { className: 'probe-text', textContent: String(document.content) })) },
        { filenamePattern: '*.mmd', displayName: 'Text' },
      );
    },
  };
  workbench.activate([fileNavigation(), probe]);
  const history = () => host.querySelector<HTMLElement>('nav.zwf-file-navigation--history')!;
  const links = () => (history().hidden ? [] : [...history().querySelectorAll('button')].map((button) => button.textContent));
  const click = (text: string) => [...history().querySelectorAll('button')].find((button) => button.textContent === text)!.click();
  return { host, project, workbench, context, history, links, click };
}

describe('file navigation: back and forward', () => {
  it('shows no history link at the start', () => {
    const { links } = setup();
    expect(links()).toEqual([]);
  });

  it('offers the way back above a supplementary file; back restores the file with its selection, then forward', async () => {
    const { workbench, context, history, links, click } = setup();
    workbench.open(path('/chapter.typ'));
    context.window.activeTextEditor!.revealRange(SourceRange.of({ from: 3, to: 10 }));
    workbench.open(path('/flow.mmd'));
    expect(links()).toEqual(['← Back to chapter.typ']);
    // above the test editor's panel, in the editing area
    expect(history().closest('.zwf-file-navigation__top')!.nextElementSibling?.querySelector('.probe-text')).not.toBeNull();
    click('← Back to chapter.typ');
    expect(context.window.activeFile).toBe('/chapter.typ');
    expect(context.window.activeTextEditor!.selection).toEqual({ from: 3, to: 10 });
    // no links above a Typst file (it has the reading order); the keys and commands still go both ways
    expect(links()).toEqual([]);
    await context.commands.executeCommand('fileNavigation.forward');
    expect(context.window.activeFile).toBe('/flow.mmd');
    expect(links()).toEqual(['← Back to chapter.typ']);
  });

  it('restores the editor the file was shown in', async () => {
    const { workbench, context } = setup();
    workbench.open(path('/chapter.typ'), { viewType: 'visualEditor' });
    workbench.open(path('/main.typ'), { viewType: 'sourceEditor' });
    await context.commands.executeCommand('fileNavigation.back');
    expect(context.window.activeTextEditor!.viewType).toBe(VISUAL_EDITOR);
  });

  it('runs as the commands and by VS Code’s keys', async () => {
    const { host, workbench, context } = setup();
    workbench.open(path('/flow.mmd'));
    await context.commands.executeCommand('fileNavigation.back');
    expect(context.window.activeFile).toBe('/main.typ');
    const mac = /Mac/.test(navigator.platform);
    host.dispatchEvent(new KeyboardEvent('keydown', { code: 'Minus', ctrlKey: true, shiftKey: true, bubbles: true }));
    expect(context.window.activeFile).toBe('/flow.mmd');
    host.dispatchEvent(new KeyboardEvent('keydown', { code: 'Minus', ctrlKey: true, altKey: !mac, bubbles: true }));
    expect(context.window.activeFile).toBe('/main.typ');
  });

  it('follows a renamed file and drops a deleted one', async () => {
    const { workbench, context, links } = setup();
    workbench.open(path('/chapter.typ'));
    workbench.open(path('/flow.mmd'));
    await context.workspace.applyEdit({ kind: 'rename', from: path('/chapter.typ'), path: path('/part.typ') });
    expect(links()).toEqual(['← Back to part.typ']);
    await context.workspace.applyEdit({ kind: 'delete', path: path('/part.typ') });
    expect(links()).toEqual(['← Back to main.typ']);
    await context.workspace.applyEdit({ kind: 'rename', from: path('/flow.mmd'), path: path('/graph.mmd') });
    expect(context.window.activeFile).toBe('/graph.mmd');
    expect(links()).toEqual(['← Back to main.typ']);
  });
});

describe('file navigation: reading order', () => {
  afterEach(() => vi.useRealTimers());

  it('follows an include written while typing once the typing pauses', () => {
    vi.useFakeTimers();
    const { host, project, workbench } = setup();
    project.apply({ kind: 'create', path: path('/appendix.typ'), content: '= Appendix\n' });
    workbench.open(path('/chapter.typ'));
    const links = () => [...host.querySelectorAll<HTMLElement>('nav.zwf-file-navigation--bottom button')].map((button) => button.textContent);
    expect(links()).toEqual(['← main.typ']);
    project.document(path('/main.typ'))!.setText('= Main\n#include "chapter.typ"\n#include "appendix.typ"\n', 'typing');
    vi.advanceTimersByTime(200);
    expect(links()).toEqual(['← main.typ']);
    vi.advanceTimersByTime(100);
    expect(links()).toEqual(['← main.typ', 'appendix.typ →']);
  });

  it('reads the order from a new main file at once', () => {
    const { host, project, workbench } = setup();
    project.apply({ kind: 'create', path: path('/book.typ'), content: '= Book\n#include "chapter.typ"\n' });
    workbench.open(path('/chapter.typ'));
    const links = () => [...host.querySelectorAll<HTMLElement>('nav.zwf-file-navigation--bottom button')].map((button) => button.textContent);
    expect(links()).toEqual(['← main.typ']);
    expect(project.setMain(path('/book.typ'))).toBeNull();
    expect(links()).toEqual(['← book.typ']);
  });
});
