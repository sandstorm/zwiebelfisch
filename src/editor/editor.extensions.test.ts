// @vitest-environment jsdom
// Tests for editor.ts: the built-in extensions in the composed widget, through the hosts' contribution
// points (preview mocked: no worker in jsdom).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { ProjectPath } from '../core/paths/paths';
import { type PageRect, type TypstDiagnostic, PageIndex, Pt } from '../core/typst-engine/typst-engine';
import type { PageClick, PdfExportOption, PreviewMenuContext, PreviewViewOption } from '../hosts/preview/preview';
import type { MenuItem } from '../hosts/commands/commands';
import type { Disposable } from '../core/disposable/disposable';
import { EventEmitter } from '../core/event-emitter/event-emitter';
import type { WindowApi } from '../hosts/window/window';
import type { Extension } from '../hosts/extension-host/extension-host';
import type { LanguagesHost } from '../hosts/languages/languages';
import type { Editor } from '@tiptap/core';
import { SOURCE_EDITOR } from '../hosts/source-editor/source-editor';
import { VISUAL_EDITOR } from '../hosts/visual-editor/visual-editor';
import type { SourceControl } from '../hosts/scm/scm';
import * as Y from 'yjs';
import { collaboration } from '../extensions/collaboration/collaboration';
import { createEditor, type EditorOptions } from './editor';
import { SourceOffset, type SourceRange } from '../core/typst-document/typst-document';

const exportPdf = vi.fn(async () => ({ pdf: new Uint8Array([37, 80, 68, 70]), diagnostics: [], missingPackages: [] }));
interface FakePreview {
  /** What the widget made it with: its toolbar's menus. */
  options: { menus: { getMenuItems(menuId: string, context: PreviewMenuContext): readonly MenuItem<PreviewMenuContext>[] } };
  pdfOptions: PdfExportOption[];
  revealed: [string, SourceRange][];
  /** Every `boxesFor(path, ranges)` (the text left out). */
  lookedUp: [string, readonly SourceRange[]][];
  /** What `setViewOptionValues` got last. */
  viewValues: Readonly<Record<string, boolean>>;
  compiled(diagnostics: TypstDiagnostic[]): void;
  click(click: PageClick): void;
  /** A successful compile was shown (`onDidRender`). */
  render(): void;
  /** The boxes of the page overlay of class `className` (none: no such overlay); `boxesFor` answers a box per range. */
  drawn(className: string): readonly PageRect[];
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
      onDidLoad = () => ({ dispose() {} });
      onDidCrash = () => ({ dispose() {} });
      isEmpty = true;
      registerPaneOverlay = () => ({ dispose() {} });
      readonly pdfOptions: unknown[] = [];
      readonly revealed: unknown[] = [];
      readonly lookedUp: unknown[] = [];
      readonly #overlays = new Map<string, readonly unknown[]>();
      readonly #renders = new EventEmitter<void>();
      readonly #diagnostics = new EventEmitter<readonly TypstDiagnostic[]>();
      readonly onDidChangeDiagnostics = this.#diagnostics.event;
      readonly #clicks = new EventEmitter<PageClick>();
      readonly onDidClickPage = this.#clicks.event;
      constructor(
        _container: unknown,
        readonly options: unknown,
      ) {
        previews.push(this as never);
      }
      compiled(diagnostics: TypstDiagnostic[]) {
        this.#diagnostics.fire(diagnostics);
      }
      click(click: PageClick) {
        this.#clicks.fire(click);
      }
      render() {
        this.#renders.fire();
      }
      drawn(className: string) {
        return this.#overlays.get(className) ?? [];
      }
      update() {}
      reveal(...args: unknown[]) {
        this.revealed.push(args);
      }
      createPageOverlay(className: string) {
        this.#overlays.set(className, []);
        return { set: (boxes: unknown[]) => this.#overlays.set(className, boxes), dispose: () => this.#overlays.delete(className) };
      }
      async boxesFor(path: string, ranges: { from: number; to: number }[]) {
        this.lookedUp.push([path, ranges]);
        return ranges.map(({ from, to }) => ({ page: 0, x: from, y: 0, w: to - from, h: 1 }));
      }
      snippet = async () => null;
      onDidRender = this.#renders.event;
      exportPdf = exportPdf;
      zoom = 'fit';
      setZoom() {}
      scale = 1;
      visiblePage = { index: 0, count: 0 };
      onDidChangeView = () => new Disposable(() => {});
      registerPdfExportOption = registry(this.pdfOptions);
      pdfExportOptions = () => this.pdfOptions;
      readonly #viewOptions: PreviewViewOption[] = [];
      readonly #viewOptionsChanged = new EventEmitter<void>();
      readonly onDidChangeViewOptions = this.#viewOptionsChanged.event;
      engineMemory = 0;
      onDidChangeEngineMemory = () => new Disposable(() => {});
      viewValues: Readonly<Record<string, boolean>> = {};
      registerViewOption = (option: PreviewViewOption) => {
        const registration = registry(this.#viewOptions)(option);
        this.#viewOptionsChanged.fire();
        return new Disposable(() => {
          registration.dispose();
          this.#viewOptionsChanged.fire();
        });
      };
      viewOptions = () => this.#viewOptions;
      setViewOptionValues(values: Readonly<Record<string, boolean>>) {
        this.viewValues = values;
      }
      registerRenderer = () => new Disposable(() => {});
      renderers = () => [{ id: 'pages', label: 'Pages' }];
      activeRenderer = 'pages';
      setActiveRenderer() {}
      onDidChangeRenderers = () => new Disposable(() => {});
      dispose() {}
    },
  };
});

function setup(options: EditorOptions) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createEditor(host, { viewType: SOURCE_EDITOR, ...options });
  const source = () => {
    const visible = [...host.querySelectorAll<HTMLElement>('.zwf-editor__pane')].find((pane) => !pane.hidden && pane.querySelector('.cm-editor'));
    return EditorView.findFromDOM(visible!.querySelector<HTMLElement>('.cm-editor')!)!;
  };
  return { host, editor, source, preview: previews.at(-1)! };
}

/** The commands of the preview toolbar's entries (menu `preview/toolbar`) while the pages are shown. */
function toolbarCommands(preview: FakePreview): string[] {
  return preview.options.menus.getMenuItems('preview/toolbar', { previewRenderer: 'pages' }).map((item) => item.command);
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
  localStorage.clear();
  previews.length = 0;
});

describe('editors', () => {
  it('shows an image in the image editor, and a Typst file in the tabs again', () => {
    const { host, editor } = setup({ source: '= Hi', files: { '/logo.png': new Uint8Array([1]) } });
    URL.createObjectURL = vi.fn(() => 'blob:1');
    URL.revokeObjectURL = vi.fn();
    editor.open('/logo.png');
    const asset = host.querySelector<HTMLElement>('[data-testid=zwf-asset]')!;
    expect(asset.hidden).toBe(false);
    // one editor: no tabs; the bar stays for the View menu
    expect(host.querySelector<HTMLElement>('.zwf-editor__tabs')!.hidden).toBe(false);
    expect(host.querySelector<HTMLElement>('[role=tablist]')!.hidden).toBe(true);
    editor.open('/main.typ');
    expect(asset.isConnected).toBe(false);
    expect(host.querySelector<HTMLElement>('[role=tablist]')!.hidden).toBe(false);
  });

  it('shows a spreadsheet in the spreadsheet editor, a text file in the text editor, any other file read-only', () => {
    const { host, editor } = setup({ source: '= Hi', files: { '/data.ic': new Uint8Array() } });
    editor.open('/data.ic');
    expect(host.querySelector<HTMLElement>('[data-testid=zwf-spreadsheet]')!.hidden).toBe(false);
    expect(host.querySelector('[data-testid=zwf-asset]')).toBeNull();
    editor.open('/main.typ');
    editor.files = { ...editor.files, '/font.otf': new Uint8Array(3) };
    editor.open('/font.otf');
    expect(host.querySelector('[data-testid=zwf-spreadsheet]')).toBeNull();
    expect(host.querySelector('[data-testid=zwf-file-info]')?.textContent).toContain('OTF file');
    editor.files = { ...editor.files, '/data.csv': 'a,b' };
    editor.open('/data.csv');
    expect(host.querySelector('[data-testid=zwf-file-info]')).toBeNull();
    expect(host.querySelector('[data-testid=zwf-text-file] .cm-content')?.textContent).toBe('a,b');
  });
});

describe('diagrams', () => {
  const diagram = () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  it('opens a .drawio.png in the diagram editor (priority over the images), any other PNG as an image', () => {
    URL.createObjectURL = vi.fn(() => 'blob:1');
    URL.revokeObjectURL = vi.fn();
    const { host, editor } = setup({ source: '= Hi', files: { '/a.drawio.png': diagram(), '/a.png': new Uint8Array([1]) } });
    editor.open('/a.drawio.png');
    expect(host.querySelector('[data-testid=zwf-diagram] iframe')).not.toBeNull();
    expect(host.querySelector('[data-testid=zwf-asset]')).toBeNull();
    editor.open('/a.png');
    expect(host.querySelector('[data-testid=zwf-diagram]')).toBeNull();
    expect(host.querySelector('[data-testid=zwf-asset] img')).not.toBeNull();
  });

  it('puts "New spreadsheet…" and "New diagram…" into the file panel\'s "New"', () => {
    const { host } = setup({ source: '= Hi', settings: { 'files.panel': 'show' } });
    const panel = host.querySelector<HTMLElement>('[data-testid=zwf-files]')!;
    panel.querySelector<HTMLButtonElement>('button[aria-label=New]')!.click();
    // the Visual editor's toolbar menus are role=menu too
    const entries = [...host.querySelectorAll('[role=menu] [role=menuitem]')].filter((entry) => !entry.closest('.zwf-toolbar'));
    expect(entries.map((entry) => entry.textContent)).toEqual([
      'New file…',
      'New spreadsheet…',
      'New diagram…',
      'New folder…',
      'Upload files…',
    ]);
  });

  it('makes the picture of an image box showing a diagram a link "Edit diagram": Mod+click opens the diagram', () => {
    URL.createObjectURL = vi.fn(() => 'blob:1');
    URL.revokeObjectURL = vi.fn();
    const { host, editor } = setup({
      viewType: VISUAL_EDITOR,
      source: '#image("img/flow.drawio.png")\n\n#image("img/logo.png")\n',
      files: { '/img/flow.drawio.png': diagram(), '/img/logo.png': new Uint8Array([1]) },
    });
    const [flow, logo] = [...host.querySelectorAll<HTMLElement>('.zwf-images__box')].map(hovered);
    expect(flow.hint).toMatch(/^Edit diagram\((⌘|Ctrl)\+click or Alt\+Enter\)$/);
    expect(logo.hint).toMatch(/^Open img\/logo\.png\(/);
    expect(flow.picture.hasAttribute('title')).toBe(false);
    expect(host.querySelector('.zwf-visual__box-actions, button[aria-label="Edit diagram"]')).toBeNull();
    modClick(flow.picture);
    expect(editor.activeFile).toBe('/img/flow.drawio.png');
    expect(host.querySelector('[data-testid=zwf-diagram]')).not.toBeNull();
  });

  it('makes the picture of a figure showing a diagram a link "Edit diagram" too', () => {
    URL.createObjectURL = vi.fn(() => 'blob:1');
    URL.revokeObjectURL = vi.fn();
    const { host, editor } = setup({
      viewType: VISUAL_EDITOR,
      source: '= Hi\n\n#figure(\n  image("diagrams/flow.drawio.png", width: 100%),\n  caption: [The flow],\n) <fig:flow>\n',
      files: { '/diagrams/flow.drawio.png': diagram() },
    });
    const flow = hovered(host.querySelector<HTMLElement>('.zwf-images__box')!);
    expect(flow.hint).toMatch(/^Edit diagram\((⌘|Ctrl)\+click or Alt\+Enter\)$/);
    modClick(flow.picture);
    expect(editor.activeFile).toBe('/diagrams/flow.drawio.png');
    expect(host.querySelector('[data-testid=zwf-diagram]')).not.toBeNull();
  });
});

describe('spreadsheets', () => {
  const SOURCE = '#import "data/budget.ic.gen.typ": sheets, values\n\n#sheets.Sheet1\n';
  const GENERATED = '#let values = (:)\n#let sheets = (:)\n';
  const FILES = { '/data/budget.ic': new Uint8Array(), '/data/budget.ic.gen.typ': GENERATED };

  /** The widget, and the merged document links of its main file (as every editor gets them), resolved. */
  function withLinks(options: EditorOptions) {
    let languages: LanguagesHost | null = null;
    // the host's merged links (the extensions get none: no extension shows links itself)
    const probe: Extension = { id: 'probe', activate: (context) => void (languages = context.languages as LanguagesHost) };
    const shown = setup({ ...options, extensions: (builtinExtensions) => [...builtinExtensions, probe] });
    const links = () =>
      languages!.provideDocumentLinks({ path: ProjectPath.of('/main.typ'), languageId: 'typst', text: SOURCE }).map((link) => languages!.resolveDocumentLink(link));
    return { ...shown, links };
  }

  it('makes the path of a spreadsheet\'s Typst file a link "Edit spreadsheet" to the spreadsheet', () => {
    const { links } = withLinks({ source: SOURCE, files: FILES });
    expect(links()).toEqual([{ range: { from: 9, to: 31 }, target: '/data/budget.ic', tooltip: 'Edit spreadsheet' }]);
  });

  it('leaves the plain file link when the spreadsheet is not in the project', () => {
    const { links } = withLinks({ source: SOURCE, files: { '/data/budget.ic.gen.typ': GENERATED } });
    expect(links()).toEqual([{ range: { from: 9, to: 31 }, target: '/data/budget.ic.gen.typ' }]);
  });

  it('Alt+Enter in the Source editor on the import path opens the spreadsheet', () => {
    const { editor, host, source } = setup({ source: SOURCE, files: FILES });
    const view = source();
    view.dispatch({ selection: { anchor: SOURCE.indexOf('budget') } });
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true }));
    expect(editor.activeFile).toBe('/data/budget.ic');
    expect(host.querySelector<HTMLElement>('[data-testid=zwf-spreadsheet]')!.hidden).toBe(false);
  });

  it('Alt+Enter on the Visual editor\'s raw box of the import line opens the spreadsheet', () => {
    const { editor, host } = setup({ viewType: VISUAL_EDITOR, source: SOURCE, files: FILES });
    const tiptap = (host.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
    tiptap.commands.setNodeSelection(0);
    expect(tiptap.state.doc.nodeAt(0)?.attrs.src).toContain('budget.ic.gen.typ');
    tiptap.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true }));
    expect(editor.activeFile).toBe('/data/budget.ic');
  });
});

describe('mermaid', () => {
  it('makes the picture of a figure reading a .mmd file a link "Edit diagram": Mod+click opens the file', () => {
    const { host, editor } = setup({
      viewType: VISUAL_EDITOR,
      source: '#figure(mermaid(read("loop.mmd")), caption: [Loop])\n',
      files: { '/loop.mmd': 'flowchart LR\n  A --> B\n' },
    });
    const { picture, hint } = hovered(host.querySelector<HTMLElement>('.zwf-visual__raw-block')!);
    expect(hint).toMatch(/^Edit diagram\(/);
    modClick(picture);
    expect(editor.activeFile).toBe('/loop.mmd');
  });
});

/** The picture of `box`, and the hint it shows after the mouse entered it and rested (the hint of every link). */
function hovered(box: HTMLElement): { picture: HTMLImageElement; hint: string } {
  const picture = box.querySelector<HTMLImageElement>('.zwf-visual__rendering')!;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  picture.dispatchEvent(new MouseEvent('mouseenter'));
  picture.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  vi.advanceTimersByTime(300);
  vi.useRealTimers();
  const hint = document.querySelector('.zwf-link-hint[role=tooltip]');
  expect(picture.getAttribute('aria-describedby')).toBe(hint?.id);
  picture.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); // ends the hover
  return { picture, hint: hint?.textContent ?? '' };
}

/** A click on `element` holding the link modifier (⌘ on Mac, Ctrl elsewhere: both held). */
function modClick(element: HTMLElement) {
  element.dispatchEvent(new MouseEvent('mousedown', { button: 0, ctrlKey: true, metaKey: true, bubbles: true, cancelable: true }));
}

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

  it('gathers the View menu at the end of the tab bar: invisible characters, then the preview\'s view options; choosing one sets it', async () => {
    const { host, preview } = setup({ source: '= Hi' });
    const open = () => {
      host.querySelector<HTMLButtonElement>('.zwf-editor__view-menu')!.click();
      return host.querySelector<HTMLElement>('[role=menu][aria-label="View"]')!;
    };
    const entries = (menu: HTMLElement) => [...menu.children].map((child) => (child.getAttribute('role') === 'separator' ? '---' : `${child.textContent} ${child.getAttribute('aria-checked')}`));
    expect(entries(open())).toEqual(['Invisible characters false', '---', '✓Comments true', 'Page guides false', 'Box outlines false', 'Block spacing false']);
    [...open().children].find((child) => child.textContent === 'Page guides')!.dispatchEvent(new MouseEvent('click'));
    await Promise.resolve();
    expect(preview.viewValues).toEqual({ 'previewGuides.pageGuides': true });
    expect(entries(open())).toContain('✓Page guides true');
  });

  it('adds a comment on Ctrl/Cmd+Alt+M in the Source editor, before the editor sees the key', () => {
    const { editor, source } = setup({ source: 'Hi\n' });
    const view = source();
    view.dispatch({ selection: { anchor: 2 } });
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', altKey: true, ctrlKey: true, bubbles: true }));
    expect(editor.source).toContain('Hi#margin-note[]');
  });

  it('signs replies as the user an extension set since (the account signed in at a server), not as the host said', () => {
    let window: WindowApi | undefined;
    const account: Extension = { id: 'test.account', activate: (context) => void (window = context.window) };
    const { host, editor } = setup({ viewType: VISUAL_EDITOR, source: 'A #margin-note[] b.\n', user: { name: 'Demo user' }, extensions: (builtins) => [...builtins, account] });
    window!.setUser({ name: 'Ann' });
    host.querySelector('[data-testid="zwf-note-marker"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    const field = host.querySelector<HTMLTextAreaElement>('[data-testid="zwf-note-card"] .zwf-comments__card-reply')!;
    field.value = 'Hi';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(editor.source).toMatch(/^A #margin-note\[- \*Ann\* \(\d{4}-\d{2}-\d{2}\): Hi\] b\.\n$/);
  });

  it('counts the diagnostics in the status bar and underlines them in the Source editor', async () => {
    const { host, preview } = setup({ source: '= Hi' });
    preview.compiled([{ severity: 'error', message: 'oops', hints: [], path: ProjectPath.of('/main.typ'), from: SourceOffset.of(0), to: SourceOffset.of(1) }]);
    const status = host.querySelector('.zwf-editor__status-bar [data-testid=zwf-status]')!;
    expect(status.textContent).toContain('1 error');
    await vi.waitFor(() => expect(host.querySelector('.cm-lintRange-error')).not.toBeNull());
  });

  it('marks the diagnostics in the Visual editor, message and hints as tooltip, also in editors made later', () => {
    const { host, editor, preview } = setup({ viewType: VISUAL_EDITOR, source: 'Hello world.\n', files: { '/a.typ': '#foo\n\nText.\n' } });
    preview.compiled([
      { severity: 'error', message: 'unknown variable: foo', hints: ['did you mean bar?'], path: ProjectPath.of('/main.typ'), from: SourceOffset.of(6), to: SourceOffset.of(11) },
      // in raw code (a block atom), of a file whose editors do not exist yet
      { severity: 'warning', message: 'unused', hints: [], path: ProjectPath.of('/a.typ'), from: SourceOffset.of(1), to: SourceOffset.of(4) },
    ]);
    const mark = host.querySelector<HTMLElement>('.ProseMirror .zwf-diagnostics__highlight')!;
    expect(mark.textContent).toBe('world');
    expect(mark.dataset.severity).toBe('error');
    expect(mark.title).toBe('unknown variable: foo\nhint: did you mean bar?');
    editor.open('/a.typ');
    const shown = [...host.querySelectorAll<HTMLElement>('.zwf-editor__pane')].find((pane) => !pane.hidden)!;
    expect(shown.querySelector<HTMLElement>('.zwf-diagnostics__highlight')?.dataset.severity).toBe('warning');
  });

  it('fills the preview toolbar: "Follow cursor", zoom, then "Download PDF" while pdfExport.download is on', () => {
    const { editor, preview } = setup({ source: '= Hi' });
    const zoom = ['previewControls.zoomOut', 'previewControls.zoomIn', 'previewControls.zoomFit', 'previewControls.zoomActualSize'];
    const all = ['previewSync.toggleFollowCursor', ...zoom, 'pdfExport.download'];
    expect(toolbarCommands(preview)).toEqual(all);
    expect(toolbarCommands(setup({ source: '= Hi', settings: { 'pdfExport.download': false } }).preview)).toEqual(all.slice(0, -1));
    editor.updateSettings({ 'pdfExport.download': false });
    expect(toolbarCommands(preview)).toEqual(all.slice(0, -1));
    editor.updateSettings({ 'pdfExport.download': undefined });
    expect(toolbarCommands(preview)).toEqual(all);
  });

  it('switches "Follow cursor" when the host changes previewSync.followCursor, and with its button', async () => {
    const { editor, preview, source } = setup({ source: '= Hi\n', settings: { 'previewSync.followCursor': false } });
    const follow = () => preview.options.menus.getMenuItems('preview/toolbar', { previewRenderer: 'pages' })[0].toggled!({ previewRenderer: 'pages' });
    expect(follow()).toBe(false);
    await editor.executeCommand('previewSync.toggleFollowCursor');
    expect(follow()).toBe(true);
    await editor.executeCommand('previewSync.toggleFollowCursor');
    expect(follow()).toBe(false);
    editor.updateSettings({ 'previewSync.followCursor': true });
    expect(follow()).toBe(true);
    source().focus();
    source().dispatch({ selection: { anchor: 3 } });
    expect(preview.revealed.at(-1)).toEqual(['/main.typ', { from: 3, to: 3 }]);
  });

  it('offers "Save to <label>…" in the tab bar for a registered source control: asks for the message, commits, says while busy', async () => {
    const changed = new EventEmitter<void>();
    const committed: string[] = [];
    const gitlab: SourceControl & { busy: boolean } = {
      id: 'gitlab',
      label: 'GitLab',
      defaultCommitMessage: 'Edit via Zwiebelfisch',
      busy: false,
      onDidChange: changed.event,
      commit(message) {
        committed.push(message);
        this.busy = true;
        changed.fire();
      },
    };
    let registration: Disposable | undefined;
    // what the collaboration extension does for a GitLab room; source-control knows only the registry
    const room: Extension = {
      id: 'room',
      activate: ({ scm, subscriptions }) => subscriptions.push((registration = scm.registerSourceControl(gitlab))),
    };
    const { host } = setup({ source: '= Hi', extensions: (builtinExtensions) => [...builtinExtensions, room] });
    const action = () => host.querySelector<HTMLButtonElement>('.zwf-editor__tab-action[data-command="sourceControl.commit"]');
    const notifications = () => [...host.querySelectorAll('.zwf-notification__message')].map((message) => message.textContent);
    expect(action()!.textContent).toBe('Save to GitLab…');

    action()!.click();
    const form = await vi.waitFor(() => host.querySelector<HTMLFormElement>('form.zwf-quick-input')!);
    const field = form.querySelector<HTMLInputElement>('input')!;
    expect(field.value).toBe('Edit via Zwiebelfisch');
    field.value = ' Fix the intro ';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(committed).toEqual(['Fix the intro']));
    expect(action()!.textContent).toBe('Saving to GitLab…');

    action()!.click();
    await vi.waitFor(() => expect(notifications()).toEqual(['Saving to GitLab is under way.']));
    expect(host.querySelector('form.zwf-quick-input')).toBeNull();

    gitlab.busy = false;
    changed.fire();
    expect(action()!.textContent).toBe('Save to GitLab…');

    registration!.dispose();
    expect(action()).toBeNull();
  });

  it('removes the file panel while files.panel is hide (the left side keeps Help)', () => {
    const { host, editor } = setup({ source: '= Hi', files: { '/a.typ': 'A' } });
    const button = (id: string) => host.querySelector<HTMLElement>(`[data-testid=zwf-panel-toggle-${id}]`)!;
    expect(button('files').hidden).toBe(false);
    editor.updateSettings({ 'files.panel': 'hide' });
    expect(button('files').hidden).toBe(true);
    expect(button('help').hidden).toBe(false);
    editor.updateSettings({ 'files.panel': undefined });
    expect(button('files').hidden).toBe(false);
  });

  it('updateSettings merges: ids left out keep their value, undefined resets one to its default', () => {
    const { host, editor } = setup({ source: '= Hi', settings: { 'files.panel': 'hide' } });
    const files = () => host.querySelector<HTMLElement>('[data-testid=zwf-panel-toggle-files]')!;
    editor.updateSettings({ 'pdfExport.download': false });
    expect(editor.settings).toEqual({ 'files.panel': 'hide', 'pdfExport.download': false });
    expect(files().hidden).toBe(true);
    editor.updateSettings({ 'files.panel': undefined });
    expect(editor.settings).toEqual({ 'pdfExport.download': false });
    expect(Object.keys(editor.settings)).toEqual(['pdfExport.download']);
    expect(files().hidden).toBe(false);
  });

  it('keeps the preview in step (preview-sync): it follows the focused selection, and a click selects its source', () => {
    const { preview, source } = setup({ source: '= Hi\n\nText\n', settings: { 'previewSync.followCursor': true } });
    source().dispatch({ selection: { anchor: 2 } });
    expect(preview.revealed).toEqual([]);
    source().focus();
    source().dispatch({ selection: { anchor: 3 } });
    expect(preview.revealed.at(-1)).toEqual(['/main.typ', { from: 3, to: 3 }]);
    preview.click({ path: ProjectPath.of('/main.typ'), from: SourceOffset.of(6), to: SourceOffset.of(10), boxes: [] });
    expect(source().state.selection.main).toMatchObject({ from: 6, to: 10 });
  });

  it("outlines a click in the preview until the next edit (any view), the next render or once the selection moves away", () => {
    const { editor, preview, source } = setup({ source: '= Hi\n\nText more\n' });
    const boxes = [{ page: PageIndex.of(0), x: Pt.of(6), y: Pt.of(0), w: Pt.of(4), h: Pt.of(1) }];
    const click = { path: ProjectPath.of('/main.typ'), from: SourceOffset.of(6), to: SourceOffset.of(10), boxes };
    const outline = () => preview.drawn('zwf-preview-sync__click');
    preview.click(click);
    expect(outline()).toEqual(boxes);
    // selecting the clicked range (also again, as a focus may) keeps it
    source().dispatch({ selection: { anchor: 6, head: 10 } });
    expect(outline()).toEqual(boxes);
    source().dispatch({ selection: { anchor: 2 } });
    expect(outline()).toEqual([]);

    preview.click(click);
    source().dispatch({ changes: { from: 0, to: 0, insert: '!' }, selection: { anchor: 7, head: 11 } });
    expect(outline()).toEqual([]);

    // an edit from elsewhere (another editor, the API) too
    preview.click(click);
    editor.files = { '/main.typ': '= Hi\n\nOther\n' };
    expect(outline()).toEqual([]);

    preview.click({ ...click, from: SourceOffset.of(6), to: SourceOffset.of(11) });
    expect(outline()).toEqual(boxes);
    preview.render();
    expect(outline()).toEqual([]);
  });

  it('shades the selection of the shown file in the preview (Source or Visual editor) once it rests, and clears it when collapsed', async () => {
    vi.useFakeTimers();
    try {
      const { preview, source } = setup({ source: '= Hi\n\nText more\n', settings: { 'previewSync.followCursor': false } });
      const shading = () => preview.drawn('zwf-preview-sync__selection').map(({ x, w }) => [x, x + w]);
      // a drag: only where it rests is looked up
      source().dispatch({ selection: { anchor: 6, head: 8 } });
      source().dispatch({ selection: { anchor: 6, head: 10 } });
      expect(preview.lookedUp).toEqual([]);
      await vi.advanceTimersByTimeAsync(100);
      expect(preview.lookedUp).toEqual([['/main.typ', [{ from: 6, to: 10 }]]]);
      expect(shading()).toEqual([[6, 10]]);
      // new pages: looked up again at once
      preview.render();
      await vi.advanceTimersByTimeAsync(0);
      expect(preview.lookedUp).toHaveLength(2);
      expect(shading()).toEqual([[6, 10]]);
      source().dispatch({ selection: { anchor: 7 } });
      expect(shading()).toEqual([]);
      // the Visual editor: its selection in the source
      const { preview: visual, host } = setup({ viewType: VISUAL_EDITOR, source: 'Hello world.\n' });
      const tiptap = (host.querySelector('.ProseMirror') as HTMLElement & { editor: { commands: { setTextSelection(range: { from: number; to: number }): void } } }).editor;
      tiptap.commands.setTextSelection({ from: 7, to: 12 });
      await vi.advanceTimersByTimeAsync(100);
      expect(visual.lookedUp.at(-1)).toEqual(['/main.typ', [{ from: 6, to: 11 }]]);
      tiptap.commands.setTextSelection({ from: 3, to: 3 });
      expect(visual.drawn('zwf-preview-sync__selection')).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not shade what a click in the preview selected (its outline marks it), nor anything while previewSync.highlightSelection is off", async () => {
    vi.useFakeTimers();
    try {
      const { editor, preview, source } = setup({ source: '= Hi\n\nText more\n' });
      const shading = () => preview.drawn('zwf-preview-sync__selection').map(({ x, w }) => [x, x + w]);
      const boxes = [{ page: PageIndex.of(0), x: Pt.of(6), y: Pt.of(0), w: Pt.of(4), h: Pt.of(1) }];
      preview.click({ path: ProjectPath.of('/main.typ'), from: SourceOffset.of(6), to: SourceOffset.of(10), boxes });
      await vi.advanceTimersByTimeAsync(100);
      expect(preview.lookedUp).toEqual([]);
      // moved on: the outline goes, the new selection is shaded
      source().dispatch({ selection: { anchor: 6, head: 15 } });
      await vi.advanceTimersByTimeAsync(100);
      expect(preview.drawn('zwf-preview-sync__click')).toEqual([]);
      expect(shading()).toEqual([[6, 15]]);
      editor.updateSettings({ 'previewSync.highlightSelection': false });
      expect(shading()).toEqual([]);
      source().dispatch({ selection: { anchor: 0, head: 4 } });
      await vi.advanceTimersByTimeAsync(100);
      expect(preview.lookedUp).toHaveLength(1);
      expect(shading()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
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
    const blob = await editor.executeCommand<Blob>('pdfExport.export', { 'comments.include': true });
    expect(blob.type).toBe('application/pdf');
    expect(exportPdf).toHaveBeenCalledWith({ main: '/main.typ', sources: {} });
    await expect(editor.executeCommand('pdfExport.export', { nope: true })).rejects.toThrow('Unknown PDF export option: nope');
  });

  it("runs the host's own extensions with the built-ins, with their settings, and leaves out built-ins by id", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: unknown[] = [];
    const counter: Extension = {
      id: 'word-count',
      contributes: { configuration: { properties: { 'wordCount.label': { type: 'string', default: 'words', description: 'The label.' } } } },
      activate: ({ workspace, commands, subscriptions }) => {
        seen.push(workspace.getConfiguration('wordCount').get('label'));
        subscriptions.push(commands.registerCommand('wordCount.count', () => 2));
      },
    };
    const { editor, preview } = setup({
      source: '= Hi',
      settings: { 'wordCount.label': 'Wörter', 'pdfExport.download': false },
      extensions: (builtinExtensions) => [...builtinExtensions.filter((extension) => extension.id !== 'preview-sync'), counter],
    });
    expect(seen).toEqual(['Wörter']);
    await expect(editor.executeCommand('wordCount.count')).resolves.toBe(2);
    expect(toolbarCommands(preview)).toEqual(['previewControls.zoomOut', 'previewControls.zoomIn', 'previewControls.zoomFit', 'previewControls.zoomActualSize']);
    // pdfExport.download is declared, but previewSync.followCursor is not without preview-sync
    setup({ source: '= Hi', settings: { 'previewSync.followCursor': false }, extensions: (builtinExtensions) => builtinExtensions.filter((e) => e.id !== 'preview-sync') });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown setting previewSync.followCursor'));
    warn.mockRestore();
  });

  it('finds with search everywhere what the built-ins offer, a group each, in their order', async () => {
    const source = '#import "styles.typ": note\n= Results <results>\n#figure(table(columns: 1)[a], caption: [Runs])\nCold #margin-note[- *Ada* (2026-10-10): Results?]\n';
    const { host, editor } = setup({ source, files: { '/styles.typ': '/// @style block Note\n#let note(body) = block(body)\n', '/data.csv': 'results,1\n' } });
    await editor.executeCommand('workbench.action.searchEverywhere', 'results');
    await vi.waitFor(() => expect(host.querySelector('.zwf-quick-pick__progress')!.hasAttribute('hidden')).toBe(true));
    const headings = [...host.querySelectorAll('.zwf-quick-pick__heading')].map((heading) => heading.firstChild!.textContent);
    expect(headings).toEqual(['Headings', 'Labels', 'Comments', 'Text', 'Find in files']);
    await editor.executeCommand('workbench.action.searchEverywhere', '');
    const all = [...host.querySelectorAll('.zwf-quick-pick__heading')].map((heading) => heading.firstChild!.textContent);
    expect(all).toEqual(['Files', 'Headings', 'Labels', 'Figures', 'Commands', 'Styles', 'Comments', 'Settings']);
  });

  it('removes everything it added on dispose', () => {
    const { host, editor } = setup({ source: '= Hi', files: { '/a.typ': 'A' } });
    editor.dispose();
    expect(host.children).toHaveLength(0);
    expect(host.classList.contains('zwf-editor')).toBe(false);
  });
});

describe('collaboration', () => {
  it('shows "Connecting to the room…" over the editing area, which takes no input, until the room\'s text is there', async () => {
    const room = new Y.Doc();
    const shared = new Y.Text();
    room.getMap<Y.Text>('files').set('/main.typ', shared);
    shared.insert(0, 'Room text');
    const { host, source } = setup({ source: 'Local text', extensions: (builtins) => [...builtins, collaboration({ doc: room })] });
    const area = host.querySelector('.zwf-editor__editor-area')!;
    expect(host.querySelector('[data-testid=zwf-editing-progress] [role=status]')?.textContent).toBe('Connecting to the room…');
    expect(area.hasAttribute('inert')).toBe(true);
    await vi.waitFor(() => expect(host.querySelector('[data-testid=zwf-editing-progress]')).toBeNull());
    expect(area.hasAttribute('inert')).toBe(false);
    expect(source().state.doc.toString()).toBe('Room text');
  });

  it('makes the account signed in at the server the window\'s user (comments are signed with the name the others see)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ provider: 'gitlab', id: '2', name: 'Ann' }))));
    let window: WindowApi | undefined;
    const probe: Extension = { id: 'test.probe', activate: (context) => void (window = context.window) };
    const { editor } = setup({
      source: '',
      user: { name: 'Demo user', color: '#123456' },
      extensions: (builtins) => [...builtins, collaboration({ url: 'ws://127.0.0.1:9', room: 'r1' }), probe],
    });
    try {
      await vi.waitFor(() => expect(window!.user).toEqual({ name: 'Ann', color: '#123456' }));
    } finally {
      editor.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("a replace in files reaches the other widget as exact edits: what the other typed meanwhile stays, and its results follow", async () => {
    // two rooms' copies whose updates wait while `paused`, as over a slow connection
    const [ann, bob] = [new Y.Doc(), new Y.Doc()];
    let paused = false;
    const waiting: [Y.Doc, Uint8Array][] = [];
    const relay = (from: Y.Doc, to: Y.Doc) => from.on('update', (update: Uint8Array, origin: unknown) => origin !== 'relay' && (paused ? waiting.push([to, update]) : Y.applyUpdate(to, update, 'relay')));
    relay(ann, bob);
    relay(bob, ann);
    const shared = new Y.Text();
    ann.getMap<Y.Text>('files').set('/main.typ', shared);
    shared.insert(0, 'A cat.\n\nAnother cat.\n');
    const widgets = [ann, bob].map((doc) => setup({ source: '', extensions: (builtins) => [...builtins, collaboration({ doc })] }));
    await vi.waitFor(() => expect(widgets.map((widget) => widget.editor.source)).toEqual(['A cat.\n\nAnother cat.\n', 'A cat.\n\nAnother cat.\n']));
    const [annWidget, bobWidget] = widgets;
    const status = (widget: typeof annWidget) => widget.host.querySelector('[data-testid=zwf-search] [role=status]')?.textContent;
    await bobWidget.editor.executeCommand('workbench.action.findInFiles', { query: 'cat' });
    await vi.waitFor(() => expect(status(bobWidget)).toBe('2 results in 1 file'));
    paused = true;
    bobWidget.source().dispatch({ changes: { from: 21, insert: 'Bye.\n' }, userEvent: 'input.type' });
    await annWidget.editor.executeCommand('workbench.action.replaceInFiles', { query: 'cat', replace: 'dog' });
    await vi.waitFor(() => expect(status(annWidget)).toBe('2 results in 1 file'));
    annWidget.host.querySelector<HTMLButtonElement>('.zwf-search__replace-all')!.click();
    await vi.waitFor(() => expect(annWidget.editor.source).toBe('A dog.\n\nAnother dog.\n'));
    paused = false;
    for (const [to, update] of waiting.splice(0)) Y.applyUpdate(to, update, 'relay');
    expect(widgets.map((widget) => widget.editor.source)).toEqual(['A dog.\n\nAnother dog.\nBye.\n', 'A dog.\n\nAnother dog.\nBye.\n']);
    await vi.waitFor(() => expect(status(bobWidget)).toBe('No results'));
  });
});
