// @vitest-environment jsdom
// Tests for workbench-host.ts: the contribution points as an extension uses them (preview mocked: no worker in jsdom).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { Disposable } from '../../core/disposable/disposable';
import { ProjectPath } from '../../core/paths/paths';
import { Project } from '../../core/project/project';
import type { TypstDocument } from '../../core/typst-document/typst-document';
import type { ExtensionContext } from './workbench';
import { WorkbenchHost, type WorkbenchOptions } from './workbench';

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
    destroy() {}
  },
}));

const path = ProjectPath.of;

function setup(activate: (context: ExtensionContext) => void = () => {}, options: WorkbenchOptions = {}) {
  const host = document.body.appendChild(document.createElement('div'));
  const project = new Project(path('/main.typ'), { '/main.typ': '= Main\n', '/a.typ': 'A\n', '/logo.png': new Uint8Array([1]) });
  const workbench = new WorkbenchHost(host, project, { mode: 'source', ...options });
  workbench.activate([{ id: 'test', activate }]);
  return { host, project, workbench };
}

afterEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
});

describe('WorkbenchHost', () => {
  it('shows the main file once the extensions are active, and tells them about every file shown', () => {
    const shown: string[] = [];
    const { workbench } = setup(({ workbench }) => void workbench.onDidShowFile((file) => shown.push(file)));
    workbench.open(path('/a.typ'));
    workbench.open(path('/a.typ'));
    workbench.open(path('/missing.typ'));
    expect(shown).toEqual(['/main.typ', '/a.typ', '/a.typ']);
    expect(workbench.activeFile).toBe('/a.typ');
  });

  it('reports a change of the shown file to the host (onOpen), not the same file again', () => {
    const onOpen = vi.fn();
    const { workbench } = setup(undefined, { onOpen });
    workbench.open(path('/main.typ'));
    workbench.open(path('/a.typ'));
    expect(onOpen.mock.calls).toEqual([['/a.typ']]);
  });

  it('applies a change only if the project and then the host allow it', async () => {
    const allowFileChange = vi.fn(async () => false);
    const { workbench, project } = setup(undefined, { allowFileChange });
    expect(await workbench.applyChange({ kind: 'delete', path: path('/main.typ') })).toMatch(/main file/i);
    expect(allowFileChange).not.toHaveBeenCalled();
    expect(await workbench.applyChange({ kind: 'delete', path: path('/a.typ') })).toBe('This change is not allowed here.');
    allowFileChange.mockResolvedValue(true);
    expect(await workbench.applyChange({ kind: 'delete', path: path('/a.typ') })).toBeNull();
    expect(project.has(path('/a.typ'))).toBe(false);
  });

  it('keeps a renamed shown file shown, and falls back to the main file when it is deleted', () => {
    const { workbench, project } = setup();
    workbench.open(path('/a.typ'));
    project.apply({ kind: 'rename', from: path('/a.typ'), path: path('/b.typ') });
    expect(workbench.activeFile).toBe('/b.typ');
    project.apply({ kind: 'delete', path: path('/b.typ') });
    expect(workbench.activeFile).toBe('/main.typ');
  });

  it('puts side panels, status bar items and tab bar items into the frame, and takes them out on destroy', () => {
    const { host, workbench } = setup(({ workbench, subscriptions }) => {
      const doc = workbench.ownerDocument;
      const panel = workbench.registerSidePanel('outline', { label: 'Outline', icon: doc.createElement('span') });
      panel.body.textContent = 'outline';
      panel.setDefault(true);
      const status = doc.createElement('span');
      status.textContent = 'status';
      const action = doc.createElement('button');
      action.textContent = 'action';
      subscriptions.push(panel, workbench.registerStatusBarItem(status), workbench.registerTabBarItem(action, { mode: 'visual' }));
    });
    expect(host.querySelector('[data-panel=outline]')!.textContent).toBe('outline');
    expect(host.querySelector('.typst-editor__status-bar')!.textContent).toBe('status');
    const action = host.querySelector<HTMLElement>('.typst-editor__tabs button:not([role=tab])')!;
    expect(action.hidden).toBe(true); // a Visual-only action, in the Source tab
    workbench.destroy();
    expect(host.children).toHaveLength(0);
    expect(action.isConnected).toBe(false);
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
    const { workbench } = setup(undefined, { mode: 'visual' });
    workbench.open(path('/a.typ'), { selection: { from: 0, to: 1 }, mode: 'source' });
    const editor = workbench.activeTextEditor!;
    expect(editor.document.text).toBe('A\n');
    expect(editor.mode).toBe('source');
    expect(editor.selection).toEqual({ from: 0, to: 1 });
  });

  it('tells about a moved selection in an editor, after it has the new one', () => {
    const seen: { from: number; to: number }[] = [];
    const { workbench } = setup(({ workbench }) => void workbench.onDidChangeTextEditorSelection(({ textEditor }) => seen.push(textEditor.selection)));
    workbench.activeTextEditor!.revealRange(2, 4);
    expect(seen.at(-1)).toEqual({ from: 2, to: 4 });
  });

  it('has no active editor while another kind of file is shown', () => {
    const { workbench } = setup();
    expect(workbench.activeTextEditor?.document.text).toBe('= Main\n');
    workbench.open(path('/logo.png'));
    expect(workbench.activeTextEditor).toBeNull();
  });

  it('applies the Visual view contributions to the Visual view of each document', () => {
    const provider = vi.fn((_view: { document: TypstDocument }) => []);
    const { workbench } = setup(({ visualView, subscriptions }) => subscriptions.push(visualView.registerEditorExtension(provider)));
    workbench.open(path('/a.typ'));
    expect(provider.mock.calls.map(([view]) => view.document.text)).toEqual(['= Main\n', 'A\n']);
  });

  it('applies the Source view contributions to every Source view, and gives the extensions the preview', () => {
    const item = () => ({ elements: [] });
    let preview: ExtensionContext['preview'] | null = null;
    const { host, workbench } = setup((context) => {
      preview = context.preview;
      context.subscriptions.push(
        context.sourceView.registerExtension(EditorView.editorAttributes.of({ class: 'contributed' })),
        context.preview.registerToolbarItem(item),
      );
    });
    workbench.open(path('/a.typ'));
    expect(host.querySelectorAll('.cm-editor.contributed')).toHaveLength(2);
    expect((preview as unknown as { toolbarItems: unknown[] }).toolbarItems).toEqual([item]);
    workbench.destroy();
    expect((preview as unknown as { toolbarItems: unknown[] }).toolbarItems).toEqual([]);
  });

  it('tells whether the user works in the editing area', () => {
    const { host, workbench } = setup();
    expect(workbench.isEditorFocused()).toBe(false);
    host.querySelector<HTMLElement>('.typst-editor__left .cm-content')!.focus();
    expect(workbench.isEditorFocused()).toBe(true);
  });

  it("shows the links of the registered providers in the Source views and raw boxes' code, with the path of their file", () => {
    const seen: string[] = [];
    const { host } = setup(({ workbench, subscriptions }) =>
      subscriptions.push(
        workbench.registerDocumentLinkProvider({
          provideDocumentLinks: ({ path, text }) => (seen.push(path), [{ range: { from: 2, to: text.length - 1 } }]),
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
