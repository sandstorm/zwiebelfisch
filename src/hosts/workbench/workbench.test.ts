// @vitest-environment jsdom
// Tests for workbench.ts (WorkbenchHost): the contribution points as an extension uses them (preview mocked: no worker in jsdom).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import { Project } from '../../core/project/project';
import { SourceRange, type TypstDocument } from '../../core/typst-document/typst-document';
import { SOURCE_EDITOR } from '../source-editor/source-editor';
import { VISUAL_EDITOR } from '../visual-editor/visual-editor';
import { type ExtensionContext, WorkbenchHost, type WorkbenchOptions } from './workbench';

/** The main files the (mocked) preview compiled. */
const made = vi.hoisted(() => ({ compiled: [] as string[] }));

vi.mock('../preview/preview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Preview: class {
    constructor(parent: HTMLElement) {
      parent.append(Object.assign(document.createElement('div'), { className: 'mock-preview' }));
    }
    readonly toolbarItems: unknown[] = [];
    update(_files: unknown, main: string) {
      made.compiled.push(main);
    }
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
  const workbench = new WorkbenchHost(host, project, { viewType: SOURCE_EDITOR, ...options });
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

  it('compiles the new main file once it is set', () => {
    const { project } = setup();
    made.compiled = [];
    expect(project.setMain(path('/a.typ'))).toBeNull();
    expect(made.compiled).toEqual(['/a.typ']);
  });

  it('puts side panels and status bar items into the frame, and takes them out on dispose', () => {
    const { host, workbench } = setup(({ window, workbench, subscriptions }) => {
      const doc = workbench.ownerDocument;
      const panel = workbench.registerSidePanel('outline', { label: 'Outline', icon: '<svg></svg>' });
      panel.body.textContent = 'outline';
      panel.setDefault(true);
      const status = doc.createElement('span');
      status.textContent = 'status';
      subscriptions.push(panel, window.registerStatusBarItem(status, { alignment: 'left' }));
    });
    expect(host.querySelector('[data-panel=outline]')!.textContent).toBe('outline');
    expect(host.querySelector('.zwf-editor__status-bar')!.textContent).toBe('status');
    workbench.dispose();
    expect(host.children).toHaveLength(0);
  });

  it("puts the preview into the right side's built-in panel, first on its rail and shown by default", () => {
    const { host } = setup(({ workbench }) => {
      workbench.registerSidePanel('devtools', { label: 'Devtools', icon: '<svg></svg>', side: 'right' });
    });
    const right = host.querySelector<HTMLElement>('.zwf-editor__side--right')!;
    expect([...right.querySelectorAll<HTMLElement>('.zwf-editor__rail-button')].map((button) => button.title)).toEqual(['Preview', 'Devtools']);
    const preview = right.querySelector<HTMLElement>('[data-panel=preview]')!;
    expect(preview.querySelector('.mock-preview')).not.toBeNull();
    expect(preview.hidden).toBe(false);
    expect(right.querySelector<HTMLElement>('[data-panel=devtools]')!.hidden).toBe(true);
  });

  it('shows the right side panel the setting workbench.rightSidePanel names, none for null', () => {
    const { host, workbench } = setup(({ workbench }) => {
      workbench.registerSidePanel('devtools', { label: 'Devtools', icon: '<svg></svg>', side: 'right' });
    }, { settings: { 'workbench.rightSidePanel': 'devtools' } });
    const shown = () => [...host.querySelectorAll<HTMLElement>('.zwf-editor__side--right .zwf-editor__panel-body')].filter((body) => !body.hidden).map((body) => body.dataset.panel);
    expect(shown()).toEqual(['devtools']);
    workbench.updateSettings({ 'workbench.rightSidePanel': null });
    expect(shown()).toEqual([]);
    workbench.updateSettings({ 'workbench.rightSidePanel': undefined });
    expect(shown()).toEqual(['preview']);
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
        workbench.registerMenuItem('editor/title', { command: 'test.visual', title: 'Visual only', when: (context) => context.activeCustomEditorId === VISUAL_EDITOR }),
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

  it('shows "View" at the end of the tab bar while the menu `view` has entries, for any editor; it pops up the menu with check marks', async () => {
    const ran: string[] = [];
    let wrapped = false;
    const view = { registration: new Disposable(() => {}) };
    const { host, workbench } = setup(({ commands, workbench, subscriptions }) => {
      subscriptions.push(
        commands.registerCommand('test.wrap', () => ran.push('wrap')),
        workbench.registerMenuItem('editor/title', { command: 'test.wrap', title: 'Wrap', when: (context) => context.resource === '/a.typ' }),
      );
      view.registration = Disposable.from(
        workbench.registerMenuItem('view', { command: 'test.wrap', title: 'Wrap lines', group: 'editor', toggled: () => wrapped }),
        workbench.registerMenuItem('view', { command: 'test.zoom', title: 'Zoom', group: 'preview', when: (context) => context.activeCustomEditorId === SOURCE_EDITOR }),
      );
    });
    const bar = host.querySelector<HTMLElement>('.zwf-editor__tabs')!;
    const actions = () => [...bar.querySelectorAll<HTMLButtonElement>('[role=toolbar][aria-label="Editor actions"] button')];
    const viewButton = () => actions().find((button) => button.textContent === 'View');
    expect(actions().map((button) => button.textContent)).toEqual(['View']);
    // a file with one editor: no tabs, the bar stays for "View"
    workbench.open(path('/logo.png'));
    expect(bar.hidden).toBe(false);
    expect(bar.querySelector<HTMLElement>('[role=tablist]')!.hidden).toBe(true);
    workbench.open(path('/a.typ'));
    expect(actions().map((button) => button.textContent)).toEqual(['Wrap', 'View']);
    expect(viewButton()!.getAttribute('aria-haspopup')).toBe('menu');

    wrapped = true;
    viewButton()!.click();
    const menu = host.querySelector<HTMLElement>('[role=menu][aria-label="View"]')!;
    expect([...menu.children].map((child) => [child.getAttribute('role'), child.getAttribute('aria-checked'), child.textContent])).toEqual([
      ['menuitemcheckbox', 'true', '✓Wrap lines'],
      ['separator', null, ''],
      ['menuitem', null, 'Zoom'],
    ]);
    menu.querySelector<HTMLElement>('[role=menuitemcheckbox]')!.click();
    await Promise.resolve();
    expect(ran).toEqual(['wrap']);

    view.registration.dispose();
    expect(viewButton()).toBeUndefined();
    workbench.open(path('/logo.png'));
    expect(bar.hidden).toBe(true);
  });

  it('names the shown editor in the editor/title context (`activeCustomEditorId`) for any file, not only Typst files', () => {
    const { host, workbench } = setup(({ commands, window, workbench, subscriptions }) => {
      for (const [viewType, displayName] of [['test.image', 'Image'], ['test.pixels', 'Pixels']]) {
        subscriptions.push(window.registerCustomEditorProvider(viewType, { resolveCustomEditor: () => {} }, { filenamePattern: '*.png', displayName }));
      }
      subscriptions.push(
        commands.registerCommand('test.zoom', () => {}),
        workbench.registerMenuItem('editor/title', { command: 'test.zoom', title: 'Zoom', when: (context) => context.activeCustomEditorId === 'test.pixels' }),
      );
    });
    const actions = () => [...host.querySelectorAll('[role=toolbar][aria-label="Editor actions"] button')].map((button) => button.textContent);
    workbench.open(path('/logo.png'));
    expect(actions()).toEqual([]);
    workbench.open(path('/logo.png'), { viewType: 'test.pixels' });
    expect(actions()).toEqual(['Zoom']);
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

  it("gives menu items their command's declared title and icon unless they have their own", () => {
    const host = document.body.appendChild(document.createElement('div'));
    const workbench = new WorkbenchHost(host, new Project(path('/main.typ'), { '/main.typ': '' }), { viewType: SOURCE_EDITOR });
    workbench.activate([
      {
        id: 'test',
        contributes: { commands: [{ command: 'test.declared', title: 'Declared…', icon: '<svg/>' }] },
        activate: ({ commands, workbench: bench, subscriptions }) => {
          subscriptions.push(commands.registerCommand('test.declared', () => {}), commands.registerCommand('test.plain', () => {}));
          subscriptions.push(bench.registerMenuItem('test/menu', { command: 'test.declared' }));
          subscriptions.push(bench.registerMenuItem('test/menu', { command: 'test.declared', title: 'Own' }));
          subscriptions.push(bench.registerMenuItem('test/menu', { command: 'test.plain' }));
        },
      },
    ]);
    expect(workbench.getMenuItems('test/menu').map(({ title, icon }) => [title, icon])).toEqual([
      ['Declared…', '<svg/>'],
      ['Own', '<svg/>'],
      ['test.plain', undefined],
    ]);
  });

  it('shows the text and takes edits while the preview still loads the compiler', () => {
    const { host, project } = setup();
    const content = host.querySelector<HTMLElement>('.zwf-editor__editor-area .cm-content')!;
    expect(content.textContent).toContain('= Main');
    const view = EditorView.findFromDOM(content)!;
    view.dispatch({ changes: { from: view.state.doc.length, insert: 'typed' } });
    expect(project.document(path('/main.typ'))!.text).toBe('= Main\ntyped');
  });

  it('shows messages, resolving to the item chosen', async () => {
    const { host, context } = setup();
    const answer = context.window.showWarningMessage('Delete a.typ?', 'Delete');
    const message = host.querySelector<HTMLElement>('[data-testid=zwf-notifications] [role=alert]')!;
    expect(message.textContent).toContain('Delete a.typ?');
    message.querySelector<HTMLButtonElement>('.zwf-notification__item')!.click();
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
      workbench.registerSidePanel('files', { label: 'Files', icon: '<svg></svg>' });
      expect(() => workbench.registerSidePanel('files', { label: 'Files', icon: '<svg></svg>' })).toThrow(/already/);
      const frame = { top: doc.createElement('nav'), bottom: doc.createElement('nav') };
      const registered = workbench.registerEditorFrame(frame);
      expect(() => workbench.registerEditorFrame(frame)).toThrow(/already/);
      registered.dispose();
      expect(() => workbench.registerEditorFrame(frame).dispose()).not.toThrow();
    });
  });

  it('puts the editor frame into a Typst editor’s content, around any other editor’s panel, and takes it away', () => {
    let frame!: { top: HTMLElement; bottom: HTMLElement };
    let registered!: Disposable;
    const { host, workbench } = setup(({ workbench, window }) => {
      frame = { top: workbench.ownerDocument.createElement('nav'), bottom: workbench.ownerDocument.createElement('nav') };
      registered = workbench.registerEditorFrame(frame);
      window.registerCustomEditorProvider('test.image', { resolveCustomEditor: () => {} }, { filenamePattern: '*.png', displayName: 'Image' });
    });
    const source = host.querySelector('.zwf-editor__custom-editor[data-view-type="sourceEditor"]')!;
    expect(frame.top.parentElement).toBe(source);
    expect(source.lastElementChild).toBe(frame.bottom);
    workbench.open(path('/logo.png'));
    const image = host.querySelector('.zwf-editor__custom-editor[data-view-type="test.image"]')!;
    expect([frame.top.nextElementSibling, frame.bottom.previousElementSibling]).toEqual([image, image]);
    workbench.open(path('/a.typ'));
    expect(frame.top.closest('[data-view-type="sourceEditor"]:not([hidden])')).not.toBeNull();
    workbench.open(path('/logo.png'));
    registered.dispose();
    expect([frame.top.isConnected, frame.bottom.isConnected]).toEqual([false, false]);
  });

  it('opens a file at a range, in the Source editor when asked, which then stays the choice for Typst files', () => {
    const { host, workbench, context } = setup(undefined, { viewType: VISUAL_EDITOR });
    workbench.open(path('/a.typ'), { selection: SourceRange.of({ from: 0, to: 1 }), viewType: 'sourceEditor' });
    const editor = context.window.activeTextEditor!;
    expect(editor.document.text).toBe('A\n');
    expect(editor.viewType).toBe(SOURCE_EDITOR);
    expect(editor.selection).toEqual({ from: 0, to: 1 });
    expect(host.querySelector('[role=tab][aria-selected=true]')!.textContent).toBe('Source');
    workbench.open(path('/main.typ'));
    expect(context.window.activeTextEditor!.viewType).toBe(SOURCE_EDITOR);
  });

  it('shows Typst files in the Visual and the Source editor, custom editors with tabs, kept while hidden', () => {
    const { host, workbench, context } = setup(undefined, { viewType: VISUAL_EDITOR });
    const tabs = () => [...host.querySelectorAll<HTMLElement>('[role=tab]')];
    expect(tabs().map((tab) => [tab.textContent, tab.getAttribute('aria-selected')])).toEqual([['Visual', 'true'], ['Source', 'false']]);
    const visual = host.querySelector('.zwf-editor__custom-editor[data-view-type="visualEditor"]')!;
    tabs()[1].click();
    expect(context.window.activeTextEditor!.viewType).toBe(SOURCE_EDITOR);
    expect(host.querySelector<HTMLElement>('.zwf-editor__tabs')!.hidden).toBe(false);
    workbench.open(path('/logo.png'));
    expect(host.querySelector<HTMLElement>('.zwf-editor__tabs')!.hidden).toBe(true);
    workbench.open(path('/main.typ'), { viewType: 'visualEditor' });
    expect(host.querySelector('.zwf-editor__custom-editor[data-view-type="visualEditor"]')).toBe(visual);
    expect(host.querySelectorAll('.zwf-editor__custom-editor[data-view-type$="Editor"]')).toHaveLength(2);
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

  it('applies the Visual editor contributions to the Visual editor of each document', () => {
    const provider = vi.fn((_editor: { document: TypstDocument }) => []);
    const { workbench } = setup(({ visualEditor, subscriptions }) => subscriptions.push(visualEditor.registerTiptapExtension(provider)), { viewType: VISUAL_EDITOR });
    workbench.open(path('/a.typ'));
    expect(provider.mock.calls.map(([editor]) => editor.document.text)).toEqual(['= Main\n', 'A\n']);
  });

  it('applies the Source editor contributions to every Source editor, and gives the extensions the preview', () => {
    const item = () => ({ elements: [] });
    let preview: ExtensionContext['preview'] | null = null;
    const { host, workbench } = setup((context) => {
      preview = context.preview;
      context.subscriptions.push(
        context.sourceEditor.registerCodeMirrorExtension({ editor: 'source' }, EditorView.editorAttributes.of({ class: 'contributed' })),
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
    workbench.updateSettings({ 'test.size': 5 });
    workbench.updateSettings({ 'test.size': undefined });
    expect(seen).toEqual([3, 5, 1]);
    expect(workbench.settings).toEqual({});
  });

  it('takes the theme from the setting workbench.theme, also when it changes', () => {
    const { host, workbench } = setup(undefined, { settings: { 'workbench.theme': 'dark' } });
    expect(host.dataset.theme).toBe('dark');
    workbench.updateSettings({ 'workbench.theme': 'light' });
    expect(host.dataset.theme).toBe('light');
    workbench.updateSettings({ 'workbench.theme': undefined });
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
    host.querySelector<HTMLElement>('.zwf-editor__editor-area .cm-content')!.focus();
    expect(workbench.isEditorFocused()).toBe(true);
  });

  it("gives the CodeMirror extensions to the Source editors and raw boxes' code, as Typst in their file", () => {
    const seen: string[] = [];
    const { host, workbench } = setup(({ sourceEditor, subscriptions }) =>
      subscriptions.push(
        sourceEditor.registerCodeMirrorExtension({}, ({ editor, languageId, path }) => (seen.push(`${editor} ${languageId} ${path()}`), EditorView.editorAttributes.of({ class: 'every' }))),
        sourceEditor.registerCodeMirrorExtension({ editor: 'rawBox' }, EditorView.editorAttributes.of({ class: 'box' })),
      ),
    );
    const source = host.querySelector('[data-testid=zwf-source]')!;
    expect([source.classList.contains('every'), source.classList.contains('box')]).toEqual([true, false]);
    workbench.open(path('/main.typ'), { viewType: 'visualEditor' });
    const box = host.querySelector('.zwf-visual__raw-block .cm-editor')!;
    expect([box.classList.contains('every'), box.classList.contains('box')]).toEqual([true, true]);
    expect(new Set(seen)).toEqual(new Set(['source typst /main.typ', 'rawBox typst /main.typ']));
  });
});

describe('WorkbenchHost: declared keys and rail menus', () => {
  function setupKeys() {
    const host = document.body.appendChild(document.createElement('div'));
    const project = new Project(path('/main.typ'), { '/main.typ': '= Main\n' });
    const workbench = new WorkbenchHost(host, project, { viewType: SOURCE_EDITOR });
    const ran: string[] = [];
    workbench.activate([
      {
        id: 'test',
        contributes: { keybindings: [{ command: 'test.count', key: 'Mod+Shift+KeyC' }] },
        activate: ({ commands, subscriptions }) => subscriptions.push(commands.registerCommand('test.count', () => ran.push('count'))),
      },
    ]);
    return { host, workbench, ran };
  }

  it('binds the declared keys and names them in the View menu, the tab bar and on the rail (workbench.view.<id>)', async () => {
    const { host, workbench, ran } = setupKeys();
    host.querySelector('.cm-content')!.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', ctrlKey: true, shiftKey: true, bubbles: true }));
    expect(ran).toEqual(['count']);
    workbench.registerMenuItem('view', { command: 'test.count', title: 'Count words' });
    workbench.registerMenuItem('editor/title', { command: 'test.count', title: 'Count' });
    const button = host.querySelector<HTMLElement>('.zwf-editor__tab-action[data-command="test.count"]')!;
    expect(button.title).toBe('Count (Ctrl+Shift+C)');
    host.querySelector<HTMLElement>('.zwf-editor__view-menu')!.click();
    expect(host.querySelector('.zwf-context-menu__item')!.textContent).toBe('Count words Ctrl+Shift+C');
    const panel = workbench.registerSidePanel('files', { label: 'Files', icon: '<svg></svg>' });
    workbench.commands.declareKeybindings([{ key: 'Alt+Digit1', command: 'workbench.view.files' }]);
    const rail = host.querySelector<HTMLElement>('[data-testid=zwf-panel-toggle-files]')!;
    rail.dispatchEvent(new Event('pointerenter'));
    expect(rail.title).toBe('Files (Alt+1)');
    await workbench.commands.executeCommand('workbench.view.files');
    expect(panel.visible).toBe(true);
  });


  it("shows the items of workbench/rail/left among the left rail's panels by order, naming the key, running the command", () => {
    const { host, workbench, ran } = setupKeys();
    workbench.registerSidePanel('help', { label: 'Help', icon: '<svg></svg>', order: 20 });
    workbench.registerSidePanel('files', { label: 'Files', icon: '<svg></svg>', order: 10 });
    const item = workbench.registerMenuItem('workbench/rail/left', { command: 'test.count', title: 'Count words', icon: '<svg></svg>', order: 15 });
    const buttons = () => [...host.querySelectorAll<HTMLElement>('.zwf-editor__side--left .zwf-editor__rail-button')].map((button) => button.dataset.testid ?? button.title);
    expect(buttons()).toEqual(['zwf-panel-toggle-files', 'Count words (Ctrl+Shift+C)', 'zwf-panel-toggle-help']);
    host.querySelector<HTMLElement>('.zwf-editor__rail [data-command="test.count"]')!.click();
    expect(ran).toEqual(['count']);
    item.dispose();
    expect(buttons()).toEqual(['zwf-panel-toggle-files', 'zwf-panel-toggle-help']);
  });
});
