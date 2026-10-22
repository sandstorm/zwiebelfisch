// @vitest-environment jsdom
// Tests for files.ts: the file panel's commands and menus in the composed hosts (Widget) (preview mocked: no worker in jsdom).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import { Project } from '../../core/project/project';
import type { Extension } from '../../hosts/extension-host/extension-host';
import { Widget } from '../../editor/widget/widget';
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

const row = (host: HTMLElement, title: string) => host.querySelector<HTMLElement>(`[role=treeitem][title="${title}"]`)!;

afterEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
});

function setup(more: Extension[] = [], { mainLocked = false } = {}) {
  const host = document.body.appendChild(document.createElement('div'));
  const project = new Project(path('/main.typ'), { '/main.typ': '= Main\n', '/chapters/a.typ': 'A\n', '/chapters/data.csv': 'a,b\n' }, { mainLocked });
  const widget = new Widget(host, project, { settings: { 'files.panel': 'show' } });
  widget.activate([files(), ...more]);
  const row = (title: string) => host.querySelector<HTMLElement>(`[role=treeitem][title="${title}"]`)!;
  const contextMenu = (title: string) => {
    row(title).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    return [...host.querySelectorAll<HTMLElement>('[role=menu] [role=menuitem]')];
  };
  return { host, project, widget, row, contextMenu };
}

describe('files', () => {
  it('fills the panel\'s menus with its commands: "New" and the context menu of a row', () => {
    const { host, widget, contextMenu } = setup();
    expect(widget.window.getMenuItems('files/new').map((item) => item.command)).toEqual(['files.newFile', 'files.newFolder', 'files.upload']);
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
    const { contextMenu } = setup([{
      id: 'test',
      activate: ({ commands, window, subscriptions }) =>
        subscriptions.push(
          commands.registerCommand('test.copyPath', (resource) => seen.push(resource)),
          window.registerMenuItem('files/row', { command: 'test.copyPath', title: 'Copy path', group: 'z', when: (context) => context.resourceKind === 'file' }),
        ),
    }]);
    expect(contextMenu('chapters').map((entry) => entry.textContent)).not.toContain('Copy path');
    const entries = contextMenu('main.typ');
    entries.find((entry) => entry.textContent === 'Copy path')!.click();
    expect(seen).toEqual(['/main.typ']);
  });

  it('opens a file no other editor opens read-only: its name, size and type', () => {
    const { host, project, widget } = setup();
    project.apply({ kind: 'create', path: path('/fonts/Serif.otf'), content: new Uint8Array(2048) });
    widget.window.showDocument(path('/fonts/Serif.otf'));
    const info = host.querySelector<HTMLElement>('[data-view-type="files.file"] [data-testid=zwf-file-info]')!;
    expect(info.querySelector('h2')?.textContent).toBe('fonts/Serif.otf');
    expect([...info.querySelectorAll('dt, dd')].map((cell) => cell.textContent)).toEqual(['Size', '2.0 KB', 'Type', 'OTF file']);
    project.apply({ kind: 'create', path: path('/LICENSE'), content: 'MIT' });
    widget.window.showDocument(path('/LICENSE'));
    expect([...host.querySelectorAll('[data-testid=zwf-file-info] dd')].map((cell) => cell.textContent)).toEqual(['3 B', 'File']);
  });

  it('"Set as main file" on a .typ row makes it the main file: first in its folder, marked; the old one can be renamed', () => {
    const { host, project, contextMenu } = setup();
    row(host, 'chapters').click();
    const titles = (entries: HTMLElement[]) => entries.map((entry) => entry.textContent);
    expect(titles(contextMenu('chapters/data.csv'))).not.toContain('Set as main file');
    contextMenu('chapters/a.typ').find((entry) => entry.textContent === 'Set as main file')!.click();
    expect(project.main).toBe('/chapters/a.typ');
    const rows = [...host.querySelectorAll<HTMLElement>('[role=treeitem]')].map((item) => item.title);
    expect(rows.slice(0, 2)).toEqual(['chapters', 'chapters/a.typ']);
    expect(row(host, 'chapters/a.typ').querySelector('.zwf-files__badge')?.textContent).toBe('Main');
    expect(row(host, 'main.typ').querySelector('.zwf-files__badge')).toBeNull();
    expect(titles(contextMenu('chapters/a.typ'))).not.toContain('Set as main file');
    expect(titles(contextMenu('main.typ'))).toEqual(['New file…', 'New folder…', 'Upload files…', 'Set as main file', 'Rename…', 'Delete']);
  });

  it('offers no "Set as main file" while the host locked the main file; the command refuses with a message', async () => {
    const { host, project, contextMenu, widget } = setup([], { mainLocked: true });
    row(host, 'chapters').click();
    expect(contextMenu('chapters/a.typ').map((entry) => entry.textContent)).not.toContain('Set as main file');
    await widget.commands.executeCommand('files.setMainFile', path('/chapters/a.typ'));
    expect(project.main).toBe('/main.typ');
    await vi.waitFor(() => expect(host.querySelector('[data-testid=zwf-notifications] [role=alert]')?.textContent).toContain('The main file cannot be changed here.'));
  });

  it('a refused change is an error message', async () => {
    const { host, row } = setup();
    row('main.typ').focus();
    // drag the main file onto the folder: refused by the panel itself
    const transfer = { types: ['application/x-zwf-project-path'], getData: () => '/main.typ', setData: () => {}, files: [] };
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: transfer });
    row('chapters').dispatchEvent(drop);
    await vi.waitFor(() => expect(host.querySelector('[data-testid=zwf-notifications] [role=alert]')?.textContent).toContain('The main file stays where it is.'));
  });
});
