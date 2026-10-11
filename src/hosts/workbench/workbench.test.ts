// @vitest-environment jsdom
// Tests for workbench.ts (WorkbenchHost): the contribution points as an extension uses them (preview mocked: no worker in jsdom).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import { Project } from '../../core/project/project';
import { SourceRange, type TypstDocument } from '../../core/typst-document/typst-document';
import { type ExtensionContext, WorkbenchHost, type WorkbenchOptions } from './workbench';

vi.mock('../preview/preview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Preview: class {
    constructor(_parent: HTMLElement, readonly options: object) {}
    readonly toolbarItems: unknown[] = [];
    update() {}
    reveal() {}
    snippet = async () => null;
    onDidRender = () => new Disposable(() => {});
    onDidChangeDiagnostics = () => new Disposable(() => {});
    registerToolbarItem(item: unknown) {
      this.toolbarItems.push(item);
      return new Disposable(() => this.toolbarItems.splice(this.toolbarItems.indexOf(item), 1));
    }
    dispose() {}
  },
}));

const path = ProjectPath.of;

function setup(activate: (context: ExtensionContext) => void = () => {}, options: WorkbenchOptions = {}) {
  const host = document.body.appendChild(document.createElement('div'));
  const project = new Project(path('/main.typ'), { '/main.typ': '= Main\n', '/a.typ': 'A\n', '/logo.png': new Uint8Array([1]) });
  const workbench = new WorkbenchHost(host, project, { mode: 'source', ...options });
  let context: ExtensionContext | null = null;
  workbench.activate([{ id: 'test', activate: (given) => activate((context = given)) }]);
  return { host, project, workbench, context: context! };
}

afterEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
});

describe('WorkbenchHost', () => {
  it('shows the main file once the extensions are active, and tells them about every file shown', () => {
    const shown: string[] = [];
    const { workbench } = setup(({ window }) => void window.onDidChangeActiveFile((file) => shown.push(file)));
    workbench.open(path('/a.typ'));
    workbench.open(path('/a.typ'));
    workbench.open(path('/missing.typ'));
    expect(shown).toEqual(['/main.typ', '/a.typ', '/a.typ']);
    expect(workbench.window.activeFile).toBe('/a.typ');
  });

  it('reports a change of the shown file to the host (onOpen), not the same file again', () => {
    const onOpen = vi.fn();
    const { workbench } = setup(undefined, { onOpen });
    workbench.open(path('/main.typ'));
    workbench.open(path('/a.typ'));
    expect(onOpen.mock.calls).toEqual([['/a.typ']]);
  });

  it("gives extensions the host's veto on changes (workspace.applyEdit)", async () => {
    const allowFileChange = vi.fn(async () => false);
    const { project, context } = setup(undefined, { allowFileChange });
    expect(await context.workspace.applyEdit({ kind: 'delete', path: path('/a.typ') })).toBe('This change is not allowed here.');
    expect(project.has(path('/a.typ'))).toBe(true);
  });

  it('keeps a renamed shown file shown, and falls back to the main file when it is deleted', () => {
    const { workbench, project } = setup();
    workbench.open(path('/a.typ'));
    project.apply({ kind: 'rename', from: path('/a.typ'), path: path('/b.typ') });
    expect(workbench.window.activeFile).toBe('/b.typ');
    project.apply({ kind: 'delete', path: path('/b.typ') });
    expect(workbench.window.activeFile).toBe('/main.typ');
  });

  it('puts side panels and status bar items into the frame, and takes them out on dispose', () => {
    const { host, workbench } = setup(({ window, workbench, subscriptions }) => {
      const doc = workbench.ownerDocument;
      const panel = workbench.registerSidePanel('outline', { label: 'Outline', icon: doc.createElement('span') });
      panel.body.textContent = 'outline';
      panel.setDefault(true);
      const status = doc.createElement('span');
      status.textContent = 'status';
      subscriptions.push(panel, window.registerStatusBarItem(status, { alignment: 'left' }));
    });
    expect(host.querySelector('[data-panel=outline]')!.textContent).toBe('outline');
    expect(host.querySelector('.typst-editor__status-bar')!.textContent).toBe('status');
    workbench.dispose();
    expect(host.children).toHaveLength(0);
  });

  it("shows the editor/title menu in the tab bar: the entries whose `when` holds for the tab and file, in order; a click runs the command", () => {
    const ran: string[] = [];
    const later = { registration: new Disposable(() => {}) };
    const { host, workbench } = setup(({ commands, workbench, subscriptions }) => {
      const register = (id: string) => commands.registerCommand(id, () => ran.push(id));
      subscriptions.push(
        register('test.always'),
        register('test.visual'),
        register('test.other'),
        workbench.registerMenuItem('editor/title', { command: 'test.visual', title: 'Visual only', when: (context) => context.editorMode === 'visual' }),
        workbench.registerMenuItem('editor/title', { command: 'test.always', title: 'Always', group: 'navigation', icon: '<svg></svg>' }),
        workbench.registerMenuItem('editor/title', { command: 'test.other', title: 'In a.typ', when: (context) => context.resource === '/a.typ' }),
      );
      later.registration = workbench.registerMenuItem('editor/title', { command: 'test.later', title: 'Later', order: -1 });
    });
    const actions = () => [...host.querySelectorAll<HTMLButtonElement>('[role=toolbar][aria-label="Editor actions"] button')];
    expect(actions().map((button) => button.textContent)).toEqual(['Always', 'Later']); // the Source tab, /main.typ
    expect(actions()[0].querySelector('svg')).not.toBeNull();
    [...host.querySelectorAll<HTMLElement>('[role=tab]')].find((tab) => tab.textContent === 'Visual')!.click();
    workbench.open(path('/a.typ'));
    expect(actions().map((button) => button.textContent)).toEqual(['Always', 'Later', 'Visual only', 'In a.typ']);
    later.registration.dispose();
    expect(actions().map((button) => button.textContent)).toEqual(['Always', 'Visual only', 'In a.typ']);
    actions()[1].click();
    expect(ran).toEqual(['test.visual']);
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    actions()[0].dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true); // the editor keeps its selection
  });

  it('gives extensions the menus registered for any id, sorted (navigation first, then groups by name, then order)', () => {
    const { workbench } = setup(({ workbench, subscriptions }) => {
      for (const [title, group, order] of [['c', 'b', 0], ['b', 'a', 2], ['a', 'a', 1], ['n', 'navigation', 9]] as const) {
        subscriptions.push(workbench.registerMenuItem('test/menu', { command: `test.${title}`, title, group, order, when: (context) => context.show !== false }));
      }
    });
    expect(workbench.getMenuItems('test/menu').map((item) => item.title)).toEqual(['n', 'a', 'b', 'c']);
    expect(workbench.getMenuItems('test/menu', { show: false })).toEqual([]);
    expect(workbench.getMenuItems('other/menu')).toEqual([]);
  });

  it('shows messages, resolving to the item chosen', async () => {
    const { host, context } = setup();
    const answer = context.window.showWarningMessage('Delete a.typ?', 'Delete');
    const message = host.querySelector<HTMLElement>('[data-testid=typst-notifications] [role=alert]')!;
    expect(message.textContent).toContain('Delete a.typ?');
    message.querySelector<HTMLButtonElement>('.typst-notification__item')!.click();
    expect(await answer).toBe('Delete');
    expect(message.isConnected).toBe(false);
  });

  it('asks for text in an input box', async () => {
    const { host, context } = setup();
    const answer = context.window.showInputBox({ title: 'Rename', prompt: 'New name', value: 'a.typ' });
    const form = host.querySelector<HTMLFormElement>('form[aria-label="Rename"]')!;
    form.querySelector('input')!.value = 'b.typ';
    form.requestSubmit();
    expect(await answer).toBe('b.typ');
    expect(form.isConnected).toBe(false);
  });

  it('refuses a second side panel with the same id, and a second editor frame', () => {
    setup(({ workbench }) => {
      const doc = workbench.ownerDocument;
      workbench.registerSidePanel('files', { label: 'Files', icon: doc.createElement('span') });
      expect(() => workbench.registerSidePanel('files', { label: 'Files', icon: doc.createElement('span') })).toThrow(/already/);
      const frame = { top: doc.createElement('nav'), bottom: doc.createElement('nav') };
      const registered = workbench.registerEditorFrame(frame);
      expect(() => workbench.registerEditorFrame(frame)).toThrow(/already/);
      registered.dispose();
      expect(() => workbench.registerEditorFrame(frame).dispose()).not.toThrow();
    });
  });

  it('opens a file at a range, in the Source tab when asked', () => {
    const { workbench, context } = setup(undefined, { mode: 'visual' });
    workbench.open(path('/a.typ'), { selection: SourceRange.of({ from: 0, to: 1 }), mode: 'source' });
    const editor = context.window.activeTextEditor!;
    expect(editor.document.text).toBe('A\n');
    expect(editor.mode).toBe('source');
    expect(editor.selection).toEqual({ from: 0, to: 1 });
  });

  it('tells about a moved selection in an editor, after it has the new one', () => {
    const seen: { from: number; to: number }[] = [];
    const { context } = setup(({ window }) => void window.onDidChangeTextEditorSelection(({ textEditor }) => seen.push(textEditor.selection)));
    context.window.activeTextEditor!.revealRange(SourceRange.of({ from: 2, to: 4 }));
    expect(seen.at(-1)).toEqual({ from: 2, to: 4 });
  });

  it('has no active editor while another kind of file is shown', () => {
    const { workbench, context } = setup();
    expect(context.window.activeTextEditor?.document.text).toBe('= Main\n');
    workbench.open(path('/logo.png'));
    expect(context.window.activeTextEditor).toBeNull();
  });

  it('applies the Visual view contributions to the Visual view of each document', () => {
    const provider = vi.fn((_view: { document: TypstDocument }) => []);
    const { workbench } = setup(({ visualView, subscriptions }) => subscriptions.push(visualView.registerTiptapExtension(provider)));
    workbench.open(path('/a.typ'));
    expect(provider.mock.calls.map(([view]) => view.document.text)).toEqual(['= Main\n', 'A\n']);
  });

  it('applies the Source view contributions to every Source view, and gives the extensions the preview', () => {
    const item = () => ({ elements: [] });
    let preview: ExtensionContext['preview'] | null = null;
    const { host, workbench } = setup((context) => {
      preview = context.preview;
      context.subscriptions.push(
        context.sourceView.registerCodeMirrorExtension(EditorView.editorAttributes.of({ class: 'contributed' })),
        context.preview.registerToolbarItem(item, { group: 'test' }),
      );
    });
    workbench.open(path('/a.typ'));
    expect(host.querySelectorAll('.cm-editor.contributed')).toHaveLength(2);
    expect((preview as unknown as { toolbarItems: unknown[] }).toolbarItems).toEqual([item]);
    workbench.dispose();
    expect((preview as unknown as { toolbarItems: unknown[] }).toolbarItems).toEqual([]);
  });

  it("gives extensions the settings they declare, with the host's values, and tells them about changes", () => {
    const host = document.body.appendChild(document.createElement('div'));
    const project = new Project(path('/main.typ'), { '/main.typ': '' });
    const workbench = new WorkbenchHost(host, project, { settings: { 'test.size': 3 } });
    const seen: unknown[] = [];
    workbench.activate([
      {
        id: 'test',
        contributes: { configuration: { properties: { 'test.size': { type: 'number', default: 1, description: 'A size.' } } } },
        activate: ({ workspace, subscriptions }) => {
          const read = () => seen.push(workspace.getConfiguration('test').get('size'));
          read();
          subscriptions.push(workspace.onDidChangeConfiguration((event) => event.affectsConfiguration('test') && read()));
        },
      },
    ]);
    workbench.settings = { 'test.size': 5 };
    workbench.settings = {};
    expect(seen).toEqual([3, 5, 1]);
    expect(workbench.settings).toEqual({});
  });

  it('takes the theme from the setting workbench.theme, also when it changes', () => {
    const { host, workbench } = setup(undefined, { settings: { 'workbench.theme': 'dark' } });
    expect(host.dataset.theme).toBe('dark');
    workbench.settings = { 'workbench.theme': 'light' };
    expect(host.dataset.theme).toBe('light');
    workbench.settings = {};
    expect(host.dataset.theme).toBeUndefined();
  });

  it('runs commands by id, resolving to their result', async () => {
    const created: unknown[] = [];
    const { workbench } = setup(({ commands, subscriptions }) =>
      subscriptions.push(commands.registerCommand('test.create', async (name: string) => (created.push(name), `made ${name}`))),
    );
    await expect(workbench.commands.executeCommand('test.create', 'a.typ')).resolves.toBe('made a.typ');
    expect(created).toEqual(['a.typ']);
    await expect(workbench.commands.executeCommand('test.unknown')).rejects.toThrow(/No command test.unknown/);
  });

  it('gives extensions who works here', () => {
    let user: unknown = null;
    setup(({ workbench }) => (user = workbench.user), { user: { name: 'Ada' } });
    expect(user).toEqual({ name: 'Ada' });
  });

  it('tells whether the user works in the editing area', () => {
    const { host, workbench } = setup();
    expect(workbench.isEditorFocused()).toBe(false);
    host.querySelector<HTMLElement>('.typst-editor__left .cm-content')!.focus();
    expect(workbench.isEditorFocused()).toBe(true);
  });

  it("shows the links of the registered providers in the Source views and raw boxes' code, with the path of their file", () => {
    const seen: string[] = [];
    const { host } = setup(({ languages, subscriptions }) =>
      subscriptions.push(
        languages.registerDocumentLinkProvider({
          provideDocumentLinks: ({ path, text }) => (seen.push(path), [{ range: SourceRange.of({ from: 2, to: text.length - 1 }) }]),
        }),
      ),
    );
    expect(seen).toContain('/main.typ');
    const marked = (root: Element) => [...root.querySelectorAll('.typst-source__path')].map((mark) => mark.textContent).join('');
    expect(marked(host.querySelector('[data-testid=typst-source]')!)).toBe('Main');
    // the box holds "= Main" without the line break
    expect(marked(host.querySelector('.typst-visual__raw-block')!)).toBe('Mai');
  });
});
