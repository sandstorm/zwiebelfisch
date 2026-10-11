// @vitest-environment jsdom
// Tests for typst-editor.ts: the built-in extensions in the composed widget, through the workbench's contribution
// points (preview mocked: no worker in jsdom).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import type { Diagnostic } from '../core/typst-engine/typst-engine';
import type { PageClick, PdfExportOption, PreviewContext, PreviewToolbarItem } from '../hosts/preview/preview';
import type { Disposable } from '../core/disposable/disposable';
import { EventEmitter } from '../core/event-emitter/event-emitter';
import type { SourceControl, SourceControlState, TypstExtension } from '../hosts/workbench/workbench';
import { createTypstEditor, type TypstEditorOptions } from './typst-editor';

const exportPdf = vi.fn(async () => ({ pdf: new Uint8Array([37, 80, 68, 70]), diagnostics: [], missingPackages: [] }));
interface FakePreview {
  toolbarItems: PreviewToolbarItem[];
  pdfOptions: PdfExportOption[];
  revealed: [string, number, number][];
  compiled(diagnostics: Diagnostic[]): void;
  click(click: PageClick): void;
}
const previews: FakePreview[] = [];

vi.mock('../hosts/preview/preview', async (importOriginal) => {
  const { Disposable } = await import('../core/disposable/disposable');
  const { EventEmitter } = await import('../core/event-emitter/event-emitter');
  const registry = <T>(list: T[]) => (item: T) => {
    list.push(item);
    return new Disposable(() => list.splice(list.indexOf(item), 1));
  };
  return {
    ...(await importOriginal<object>()),
    Preview: class {
      readonly toolbarItems: unknown[] = [];
      readonly pdfOptions: unknown[] = [];
      readonly revealed: unknown[] = [];
      readonly #diagnostics = new EventEmitter<readonly Diagnostic[]>();
      readonly onDidChangeDiagnostics = this.#diagnostics.event;
      readonly #clicks = new EventEmitter<PageClick>();
      readonly onDidClickPage = this.#clicks.event;
      constructor() {
        previews.push(this as never);
      }
      compiled(diagnostics: Diagnostic[]) {
        this.#diagnostics.fire(diagnostics);
      }
      click(click: PageClick) {
        this.#clicks.fire(click);
      }
      update() {}
      reveal(...args: unknown[]) {
        this.revealed.push(args);
      }
      snippet = async () => null;
      onDidRender = () => new Disposable(() => {});
      exportPdf = exportPdf;
      readonly #placements = new Map<unknown, string>();
      // in toolbar order: by group, then order (the built-ins use neither `navigation` nor equal places)
      registerToolbarItem = (item: unknown, placement: { group: string; order?: number }) => {
        this.#placements.set(item, `${placement.group}@${String(placement.order ?? 0).padStart(4, '0')}`);
        const registration = registry(this.toolbarItems)(item);
        this.toolbarItems.sort((a, b) => this.#placements.get(a)!.localeCompare(this.#placements.get(b)!));
        return registration;
      };
      registerPdfExportOption = registry(this.pdfOptions);
      pdfExportOptions = () => this.pdfOptions;
      dispose() {}
    },
  };
});

function setup(options: TypstEditorOptions) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createTypstEditor(host, { mode: 'source', ...options });
  const source = () => {
    const visible = [...host.querySelectorAll<HTMLElement>('.typst-editor__pane')].find((pane) => !pane.hidden && pane.querySelector('.cm-editor'));
    return EditorView.findFromDOM(visible!.querySelector<HTMLElement>('.cm-editor')!)!;
  };
  return { host, editor, source, preview: previews.at(-1)! };
}

/** What each toolbar item shows, named by its element's test id or class (made once for a stand-in preview). */
function toolbarControls(items: readonly PreviewToolbarItem[]): string[] {
  const context = {
    ownerDocument: document,
    zoom: () => 'fit',
    setZoom() {},
    scale: () => 1,
    visiblePage: () => ({ index: 0, count: 0 }),
  } satisfies PreviewContext;
  return items.map((item) => {
    const view = item(context);
    view.dispose?.();
    return view.elements.map((element) => element.dataset.testid || element.className).filter(Boolean).join(' ');
  });
}

function drop(target: HTMLElement, files: File[]) {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'] } });
  target.dispatchEvent(event);
  return event;
}

afterEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
  previews.length = 0;
});

describe('custom editors', () => {
  it('shows an image in the asset view, and a Typst file in the tabs again', () => {
    const { host, editor } = setup({ source: '= Hi', files: { '/logo.png': new Uint8Array([1]) } });
    URL.createObjectURL = vi.fn(() => 'blob:1');
    URL.revokeObjectURL = vi.fn();
    editor.open('/logo.png');
    const asset = host.querySelector<HTMLElement>('[data-testid=typst-asset]')!;
    expect(asset.hidden).toBe(false);
    expect(host.querySelector<HTMLElement>('.typst-editor__tabs')!.hidden).toBe(true);
    editor.open('/main.typ');
    expect(asset.isConnected).toBe(false);
    expect(host.querySelector<HTMLElement>('.typst-editor__tabs')!.hidden).toBe(false);
  });

  it('shows a spreadsheet in the spreadsheet editor, any other file read-only', () => {
    const { host, editor } = setup({ source: '= Hi', files: { '/data.ic': new Uint8Array() } });
    editor.open('/data.ic');
    expect(host.querySelector<HTMLElement>('[data-testid=typst-spreadsheet]')!.hidden).toBe(false);
    expect(host.querySelector('[data-testid=typst-asset]')).toBeNull();
    editor.open('/main.typ');
    editor.files = { ...editor.files, '/data.csv': 'a,b' };
    editor.open('/data.csv');
    expect(host.querySelector('[data-testid=typst-spreadsheet]')).toBeNull();
    expect(host.querySelector('[data-testid=typst-asset] pre')?.textContent).toBe('a,b');
  });
});

describe('diagrams', () => {
  const diagram = () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  it('opens a .drawio.png in the diagram editor (priority over the images), any other PNG as an image', () => {
    URL.createObjectURL = vi.fn(() => 'blob:1');
    URL.revokeObjectURL = vi.fn();
    const { host, editor } = setup({ source: '= Hi', files: { '/a.drawio.png': diagram(), '/a.png': new Uint8Array([1]) } });
    editor.open('/a.drawio.png');
    expect(host.querySelector('[data-testid=typst-diagram] iframe')).not.toBeNull();
    expect(host.querySelector('[data-testid=typst-asset]')).toBeNull();
    editor.open('/a.png');
    expect(host.querySelector('[data-testid=typst-diagram]')).toBeNull();
    expect(host.querySelector('[data-testid=typst-asset] img')).not.toBeNull();
  });

  it('puts "New spreadsheet…" and "New diagram…" into the file panel\'s "New"', () => {
    const { host } = setup({ source: '= Hi', settings: { 'files.panel': 'show' } });
    const panel = host.querySelector<HTMLElement>('[data-testid=typst-files]')!;
    panel.querySelector<HTMLButtonElement>('button[aria-label=New]')!.click();
    // the Visual view's toolbar menus are role=menu too
    const entries = [...host.querySelectorAll('[role=menu] [role=menuitem]')].filter((entry) => !entry.closest('.typst-toolbar'));
    expect(entries.map((entry) => entry.textContent)).toEqual([
      'New file…',
      'New spreadsheet…',
      'New diagram…',
      'New folder…',
      'Upload files…',
    ]);
  });

  it('offers "Edit diagram" on an image box showing a diagram of the project, which opens it', () => {
    URL.createObjectURL = vi.fn(() => 'blob:1');
    URL.revokeObjectURL = vi.fn();
    const { host, editor } = setup({
      mode: 'visual',
      source: '#image("img/flow.drawio.png")\n\n#image("img/logo.png")\n',
      files: { '/img/flow.drawio.png': diagram(), '/img/logo.png': new Uint8Array([1]) },
    });
    const [flow, logo] = [...host.querySelectorAll<HTMLElement>('.typst-visual__image')];
    const actions = (box: HTMLElement) => [...box.querySelectorAll('.typst-visual__image-tools .typst-visual__box-actions button')].map((b) => b.textContent);
    expect(actions(flow)).toEqual(['Edit diagram']);
    expect(actions(logo)).toEqual([]);
    flow.querySelector<HTMLButtonElement>('.typst-visual__box-actions button')!.click();
    expect(editor.activeFile).toBe('/img/flow.drawio.png');
    expect(host.querySelector('[data-testid=typst-diagram]')).not.toBeNull();
  });
});

describe('the built-in extensions', () => {
  it('uploads files dropped on the widget, unless the file list is hidden', async () => {
    // jsdom's File has no arrayBuffer()
    const png = Object.assign(new File([new Uint8Array([1])], 'cat.png', { type: 'image/png' }), {
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });
    const shown = setup({ source: '= Hi' });
    expect(drop(shown.host, [png]).defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(Object.keys(shown.editor.files)).toContain('/cat.png'));
    const hidden = setup({ source: '= Hi', settings: { 'files.panel': 'hide' } });
    expect(drop(hidden.host, [png]).defaultPrevented).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(Object.keys(hidden.editor.files)).toEqual(['/main.typ']);
  });

  it('adds a comment on Ctrl/Cmd+Alt+M in the Source view, before the editor sees the key', () => {
    const { editor, source } = setup({ source: 'Hi\n' });
    const view = source();
    view.dispatch({ selection: { anchor: 2 } });
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', altKey: true, ctrlKey: true, bubbles: true }));
    expect(editor.source).toContain('Hi#margin-note[]');
  });

  it('counts the diagnostics in the status bar and underlines them in the Source view', async () => {
    const { host, preview } = setup({ source: '= Hi' });
    preview.compiled([{ severity: 'error', message: 'oops', hints: [], path: '/main.typ', from: 0, to: 1 }]);
    const status = host.querySelector('.typst-editor__status-bar [data-testid=typst-status]')!;
    expect(status.textContent).toContain('1 error');
    await vi.waitFor(() => expect(host.querySelector('.cm-lintRange-error')).not.toBeNull());
  });

  it('marks the diagnostics in the Visual view, message and hints as tooltip, also in views made later', () => {
    const { host, editor, preview } = setup({ mode: 'visual', source: 'Hello world.\n', files: { '/a.typ': '#foo\n\nText.\n' } });
    preview.compiled([
      { severity: 'error', message: 'unknown variable: foo', hints: ['did you mean bar?'], path: '/main.typ', from: 6, to: 11 },
      // in raw code (a block atom), of a file whose views do not exist yet
      { severity: 'warning', message: 'unused', hints: [], path: '/a.typ', from: 1, to: 4 },
    ]);
    const mark = host.querySelector<HTMLElement>('.ProseMirror .typst-diagnostic')!;
    expect(mark.textContent).toBe('world');
    expect(mark.dataset.severity).toBe('error');
    expect(mark.title).toBe('unknown variable: foo\nhint: did you mean bar?');
    editor.open('/a.typ');
    const shown = [...host.querySelectorAll<HTMLElement>('.typst-editor__pane')].find((pane) => !pane.hidden)!;
    expect(shown.querySelector<HTMLElement>('.typst-diagnostic')?.dataset.severity).toBe('warning');
  });

  it('fills the preview toolbar: "Follow cursor", zoom, page number, then "Download PDF" while pdfExport.download is on', () => {
    const { editor, preview } = setup({ source: '= Hi' });
    const all = ['typst-preview__follow', 'typst-preview-zoom', 'typst-preview-page-number', 'typst-pdf'];
    expect(toolbarControls(preview.toolbarItems)).toEqual(all);
    expect(toolbarControls(setup({ source: '= Hi', settings: { 'pdfExport.download': false } }).preview.toolbarItems)).toEqual(all.slice(0, 3));
    editor.settings = { 'pdfExport.download': false };
    expect(toolbarControls(preview.toolbarItems)).toEqual(all.slice(0, 3));
    // back in its place, by its group and order
    editor.settings = {};
    expect(toolbarControls(preview.toolbarItems)).toEqual(all);
  });

  it('switches "Follow cursor" when the host changes previewSync.followCursor', () => {
    const { editor, preview, source } = setup({ source: '= Hi\n', settings: { 'previewSync.followCursor': false } });
    editor.settings = { 'previewSync.followCursor': true };
    source().focus();
    source().dispatch({ selection: { anchor: 3 } });
    expect(preview.revealed.at(-1)).toEqual(['/main.typ', 3, 3]);
  });

  it('offers "Save to <label>…" in the tab bar for a registered source control: asks for the message, commits, tells the outcome', async () => {
    const changed = new EventEmitter<void>();
    const committed: string[] = [];
    const gitlab: SourceControl & { state: SourceControlState } = {
      id: 'gitlab',
      label: 'GitLab',
      defaultCommitMessage: 'Edit via Typst editor',
      state: { busy: false, status: null },
      onDidChange: changed.event,
      commit(message) {
        committed.push(message);
        this.state = { busy: true, status: null };
        changed.fire();
      },
    };
    let registration: Disposable | undefined;
    // what the collaboration extension does for a GitLab room; source-control knows only the registry
    const room: TypstExtension = {
      id: 'room',
      activate: ({ workbench, subscriptions }) => subscriptions.push((registration = workbench.registerSourceControl(gitlab))),
    };
    const { host } = setup({ source: '= Hi', extensions: (builtins) => [...builtins, room] });
    const action = () => host.querySelector<HTMLButtonElement>('.typst-editor__tab-action[data-command="sourceControl.commit"]');
    const notifications = () => [...host.querySelectorAll('.typst-notification__message')].map((message) => message.textContent);
    expect(action()!.textContent).toBe('Save to GitLab…');

    action()!.click();
    const form = await vi.waitFor(() => host.querySelector<HTMLFormElement>('form.typst-quick-input')!);
    const field = form.querySelector<HTMLInputElement>('input')!;
    expect(field.value).toBe('Edit via Typst editor');
    field.value = ' Fix the intro ';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(committed).toEqual(['Fix the intro']));
    expect(action()!.textContent).toBe('Saving to GitLab…');

    action()!.click();
    await vi.waitFor(() => expect(notifications()).toEqual(['Saving to GitLab is under way.']));
    expect(host.querySelector('form.typst-quick-input')).toBeNull();

    gitlab.state = { busy: false, status: { message: 'Saving failed: no token', severity: 'error' } };
    changed.fire();
    expect(notifications()).toEqual(['Saving to GitLab is under way.', 'Saving failed: no token']);
    expect(host.querySelector('.typst-notification--error')!.textContent).toContain('Saving failed: no token');
    expect(action()!.textContent).toBe('Save to GitLab…');

    registration!.dispose();
    expect(action()).toBeNull();
  });

  it('removes the file panel while files.panel is hide', () => {
    const { host, editor } = setup({ source: '= Hi', files: { '/a.typ': 'A' } });
    const side = () => host.querySelector<HTMLElement>('.typst-editor__side')!;
    expect(side().hidden).toBe(false);
    editor.settings = { 'files.panel': 'hide' };
    expect(side().hidden).toBe(true);
    editor.settings = {};
    expect(side().hidden).toBe(false);
  });

  it('keeps the preview in step (preview-sync): it follows the focused selection, and a click selects its source', () => {
    const { preview, source } = setup({ source: '= Hi\n\nText\n', settings: { 'previewSync.followCursor': true } });
    source().dispatch({ selection: { anchor: 2 } });
    expect(preview.revealed).toEqual([]);
    source().focus();
    source().dispatch({ selection: { anchor: 3 } });
    expect(preview.revealed.at(-1)).toEqual(['/main.typ', 3, 3]);
    preview.click({ path: '/main.typ', from: 6, to: 10 });
    expect(source().state.selection.main).toMatchObject({ from: 6, to: 10 });
    preview.click({ path: '@preview/pkg/lib.typ', from: 0, to: 1 });
    expect(source().state.selection.main).toMatchObject({ from: 6, to: 10 });
  });

  it('does not follow while "Follow cursor" is off', () => {
    const { preview, source } = setup({ source: '= Hi\n', settings: { 'previewSync.followCursor': false } });
    source().focus();
    source().dispatch({ selection: { anchor: 3 } });
    expect(preview.revealed).toEqual([]);
  });

  it('exports the PDF through the pdf-export extension, with the options other extensions register', async () => {
    const { editor, preview } = setup({ source: '= Hi' });
    expect(preview.pdfOptions.map((option) => option.id)).toEqual(['comments.include']);
    const blob = await editor.exportPdf({ options: { 'comments.include': true } });
    expect(blob.type).toBe('application/pdf');
    expect(exportPdf).toHaveBeenCalledWith({ main: '/main.typ', sources: {} });
    await expect(editor.exportPdf({ options: { nope: true } })).rejects.toThrow('Unknown PDF export option: nope');
  });

  it("runs the host's own extensions with the built-ins, with their settings, and leaves out built-ins by id", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: unknown[] = [];
    const counter: TypstExtension = {
      id: 'word-count',
      contributes: { configuration: { properties: { 'wordCount.label': { type: 'string', default: 'words', description: 'The label.' } } } },
      activate: ({ workspace, workbench, subscriptions }) => {
        seen.push(workspace.getConfiguration('wordCount').get('label'));
        subscriptions.push(workbench.registerCommand('wordCount.count', () => 2));
      },
    };
    const { editor, preview } = setup({
      source: '= Hi',
      settings: { 'wordCount.label': 'Wörter', 'pdfExport.download': false },
      extensions: (builtins) => [...builtins.filter((extension) => extension.id !== 'preview-sync'), counter],
    });
    expect(seen).toEqual(['Wörter']);
    await expect(editor.executeCommand('wordCount.count')).resolves.toBe(2);
    expect(toolbarControls(preview.toolbarItems)).toEqual(['typst-preview-zoom', 'typst-preview-page-number']);
    // pdfExport.download is declared, but previewSync.followCursor is not without preview-sync
    setup({ source: '= Hi', settings: { 'previewSync.followCursor': false }, extensions: (builtins) => builtins.filter((e) => e.id !== 'preview-sync') });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown setting previewSync.followCursor'));
    warn.mockRestore();
  });

  it('removes everything it added on dispose', () => {
    const { host, editor } = setup({ source: '= Hi', files: { '/a.typ': 'A' } });
    editor.dispose();
    expect(host.children).toHaveLength(0);
    expect(host.classList.contains('typst-editor')).toBe(false);
  });
});
