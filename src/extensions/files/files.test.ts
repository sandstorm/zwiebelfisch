// @vitest-environment jsdom
// Tests for files.ts: the file panel's commands and menus in a workbench (preview mocked: no worker in jsdom).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import { Project } from '../../core/project/project';
import { type TypstExtension, WorkbenchHost } from '../../hosts/workbench/workbench';
import { files } from './files';

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

function setup(...more: TypstExtension[]) {
  const host = document.body.appendChild(document.createElement('div'));
  const project = new Project(path('/main.typ'), { '/main.typ': '= Main\n', '/chapters/a.typ': 'A\n' });
  const workbench = new WorkbenchHost(host, project, { settings: { 'files.panel': 'show' } });
  workbench.activate([files(), ...more]);
  const row = (title: string) => host.querySelector<HTMLElement>(`[role=treeitem][title="${title}"]`)!;
  const contextMenu = (title: string) => {
    row(title).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    return [...host.querySelectorAll<HTMLElement>('[role=menu] [role=menuitem]')];
  };
  return { host, project, workbench, row, contextMenu };
}

describe('files', () => {
  it('fills the panel\'s menus with its commands: "New" and the context menu of a row', () => {
    const { host, workbench, contextMenu } = setup();
    expect(workbench.getMenuItems('file/newFile').map((item) => item.command)).toEqual(['files.newFile', 'files.newFolder', 'files.upload']);
    host.querySelector<HTMLButtonElement>('button[aria-label=New]')!.click();
    expect([...host.querySelectorAll('[role=menu] [role=menuitem]')].map((entry) => entry.textContent)).toEqual(['New file…', 'New folder…', 'Upload files…']);
    expect(contextMenu('chapters').map((entry) => entry.textContent)).toEqual(['New file…', 'New folder…', 'Upload files…', 'Rename…', 'Delete']);
    expect(contextMenu('main.typ').map((entry) => entry.textContent)).toEqual(['New file…', 'New folder…', 'Upload files…']);
  });

  it('runs an entry with its row: "New file…" in a folder asks for a name there and creates the file', async () => {
    const { host, project, contextMenu } = setup();
    contextMenu('chapters')[0].click();
    const form = host.querySelector<HTMLFormElement>('form[aria-label="New file"]')!;
    const input = form.querySelector('input')!;
    expect(input.value).toBe('chapters/');
    input.value = 'chapters/b';
    form.requestSubmit();
    await vi.waitFor(() => expect(project.has(path('/chapters/b.typ'))).toBe(true));
  });

  it("other extensions add entries to the panel's menus; their command gets the row", () => {
    const seen: unknown[] = [];
    const { contextMenu } = setup({
      id: 'test',
      activate: ({ commands, workbench, subscriptions }) =>
        subscriptions.push(
          commands.registerCommand('test.copyPath', (resource) => seen.push(resource)),
          workbench.registerMenuItem('explorer/context', { command: 'test.copyPath', title: 'Copy path', group: 'z', when: (context) => context.resourceKind === 'file' }),
        ),
    });
    expect(contextMenu('chapters').map((entry) => entry.textContent)).not.toContain('Copy path');
    const entries = contextMenu('main.typ');
    entries.find((entry) => entry.textContent === 'Copy path')!.click();
    expect(seen).toEqual(['/main.typ']);
  });

  it('a refused change is an error message', async () => {
    const { host, row } = setup();
    row('main.typ').focus();
    // drag the main file onto the folder: refused by the panel itself
    const transfer = { types: ['application/x-typst-project-path'], getData: () => '/main.typ', setData: () => {}, files: [] };
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: transfer });
    row('chapters').dispatchEvent(drop);
    await vi.waitFor(() => expect(host.querySelector('[data-testid=typst-notifications] [role=alert]')?.textContent).toContain('The main file stays where it is.'));
  });
});
