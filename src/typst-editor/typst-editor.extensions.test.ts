// @vitest-environment jsdom
// Tests for typst-editor.ts: the built-in extensions in the composed widget, through the workbench's contribution
// points (preview mocked: no worker in jsdom).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { ProjectPath } from '../core/paths/paths';
import { type TypstDiagnostic, PageIndex } from '../core/typst-engine/typst-engine';
import type { PageClick, PdfExportOption, PreviewContext, PreviewToolbarItem, PreviewViewOption } from '../hosts/preview/preview';
import type { Disposable } from '../core/disposable/disposable';
import { EventEmitter } from '../core/event-emitter/event-emitter';
import type { TypstExtension } from '../hosts/workbench/workbench';
import type { LanguagesHost } from '../hosts/languages/languages';
import type { Editor } from '@tiptap/core';
import { SOURCE_EDITOR } from '../hosts/source-editor/source-editor';
import { VISUAL_EDITOR } from '../hosts/visual-editor/visual-editor';
import type { SourceControl, SourceControlState } from '../hosts/scm/scm';
import * as Y from 'yjs';
import { collaboration } from '../extensions/collaboration/collaboration';
import { FILES_MAP } from '../core/room-protocol/room-protocol';
import { createTypstEditor, type TypstEditorOptions } from './typst-editor';
import { SourceOffset, type SourceRange } from '../core/typst-document/typst-document';

const exportPdf = vi.fn(async () => ({ pdf: new Uint8Array([37, 80, 68, 70]), diagnostics: [], missingPackages: [] }));
interface FakePreview {
  toolbarItems: PreviewToolbarItem[];
  pdfOptions: PdfExportOption[];
  revealed: [string, SourceRange][];
  /** How often the click outline was removed. */
  cleared: number;
  /** Every `setSelectionHighlight(path, ranges)` (the text left out). */
  shaded: [string, readonly SourceRange[]][];
  /** What `setViewOptionValues` got last. */
  viewValues: Readonly<Record<string, boolean>>;
  compiled(diagnostics: TypstDiagnostic[]): void;
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
      cleared = 0;
      readonly shaded: unknown[] = [];
      readonly #diagnostics = new EventEmitter<readonly TypstDiagnostic[]>();
      readonly onDidChangeDiagnostics = this.#diagnostics.event;
      readonly #clicks = new EventEmitter<PageClick>();
      readonly onDidClickPage = this.#clicks.event;
      constructor() {
        previews.push(this as never);
      }
      compiled(diagnostics: TypstDiagnostic[]) {
        this.#diagnostics.fire(diagnostics);
      }
      click(click: PageClick) {
        this.#clicks.fire(click);
      }
      update() {}
      clearClickHighlight() {
        this.cleared++;
      }
      reveal(...args: unknown[]) {
        this.revealed.push(args);
      }
      setSelectionHighlight(path: string, ranges: unknown[]) {
        this.shaded.push([path, ranges]);
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
      dispose() {}
    },
  };
});

function setup(options: TypstEditorOptions) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createTypstEditor(host, { viewType: SOURCE_EDITOR, ...options });
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
    visiblePage: () => ({ index: PageIndex.of(0), count: 0 }),
  } satisfies PreviewContext;
  return items.map((item) => {
    const made = item(context);
    made.dispose?.();
    return made.elements.map((element) => element.dataset.testid || element.className).filter(Boolean).join(' ');
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
  localStorage.clear();
  previews.length = 0;
});

describe('custom editors', () => {
  it('shows an image in the image editor, and a Typst file in the tabs again', () => {
    const { host, editor } = setup({ source: '= Hi', files: { '/logo.png': new Uint8Array([1]) } });
    URL.createObjectURL = vi.fn(() => 'blob:1');
    URL.revokeObjectURL = vi.fn();
    editor.open('/logo.png');
    const asset = host.querySelector<HTMLElement>('[data-testid=typst-asset]')!;
    expect(asset.hidden).toBe(false);
    // one editor: no tabs; the bar stays for the View menu
    expect(host.querySelector<HTMLElement>('.typst-editor__tabs')!.hidden).toBe(false);
    expect(host.querySelector<HTMLElement>('[role=tablist]')!.hidden).toBe(true);
    editor.open('/main.typ');
    expect(asset.isConnected).toBe(false);
    expect(host.querySelector<HTMLElement>('[role=tablist]')!.hidden).toBe(false);
  });

  it('shows a spreadsheet in the spreadsheet editor, a text file in the text editor, any other file read-only', () => {
    const { host, editor } = setup({ source: '= Hi', files: { '/data.ic': new Uint8Array() } });
    editor.open('/data.ic');
    expect(host.querySelector<HTMLElement>('[data-testid=typst-spreadsheet]')!.hidden).toBe(false);
    expect(host.querySelector('[data-testid=typst-asset]')).toBeNull();
    editor.open('/main.typ');
    editor.files = { ...editor.files, '/font.otf': new Uint8Array(3) };
    editor.open('/font.otf');
    expect(host.querySelector('[data-testid=typst-spreadsheet]')).toBeNull();
    expect(host.querySelector('[data-testid=typst-file-info]')?.textContent).toContain('OTF file');
    editor.files = { ...editor.files, '/data.csv': 'a,b' };
    editor.open('/data.csv');
    expect(host.querySelector('[data-testid=typst-file-info]')).toBeNull();
    expect(host.querySelector('[data-testid=typst-text-file] .cm-content')?.textContent).toBe('a,b');
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
    // the Visual editor's toolbar menus are role=menu too
    const entries = [...host.querySelectorAll('[role=menu] [role=menuitem]')].filter((entry) => !entry.closest('.typst-toolbar'));
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
    const [flow, logo] = [...host.querySelectorAll<HTMLElement>('.typst-images__box')].map(hovered);
    expect(flow.hint).toMatch(/^Edit diagram\((⌘|Ctrl)\+click or Alt\+Enter\)$/);
    expect(logo.hint).toMatch(/^Open img\/logo\.png\(/);
    expect(flow.picture.hasAttribute('title')).toBe(false);
    expect(host.querySelector('.typst-visual__box-actions, button[aria-label="Edit diagram"]')).toBeNull();
    modClick(flow.picture);
    expect(editor.activeFile).toBe('/img/flow.drawio.png');
    expect(host.querySelector('[data-testid=typst-diagram]')).not.toBeNull();
  });
});

describe('spreadsheets', () => {
  const SOURCE = '#import "data/budget.ic.gen.typ": sheets, values\n\n#sheets.Sheet1\n';
  const GENERATED = '#let values = (:)\n#let sheets = (:)\n';
  const FILES = { '/data/budget.ic': new Uint8Array(), '/data/budget.ic.gen.typ': GENERATED };

  /** The widget, and the merged document links of its main file (as every editor gets them), resolved. */
  function withLinks(options: TypstEditorOptions) {
    let languages: LanguagesHost | null = null;
    // the host's merged links (the extensions get none: no extension shows links itself)
    const probe: TypstExtension = { id: 'probe', activate: (context) => void (languages = context.languages as LanguagesHost) };
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
    expect(host.querySelector<HTMLElement>('[data-testid=typst-spreadsheet]')!.hidden).toBe(false);
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
    const { picture, hint } = hovered(host.querySelector<HTMLElement>('.typst-visual__raw-block')!);
    expect(hint).toMatch(/^Edit diagram\(/);
    modClick(picture);
    expect(editor.activeFile).toBe('/loop.mmd');
  });
});

/** The picture of `box`, and the hint it shows after the mouse entered it and rested (the hint of every link). */
function hovered(box: HTMLElement): { picture: HTMLImageElement; hint: string } {
  const picture = box.querySelector<HTMLImageElement>('.typst-visual__rendering')!;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  picture.dispatchEvent(new MouseEvent('mouseenter'));
  vi.advanceTimersByTime(300);
  vi.useRealTimers();
  const hint = document.querySelector('.typst-link-hint[role=tooltip]');
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
      host.querySelector<HTMLButtonElement>('.typst-editor__view-menu')!.click();
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

  it('counts the diagnostics in the status bar and underlines them in the Source editor', async () => {
    const { host, preview } = setup({ source: '= Hi' });
    preview.compiled([{ severity: 'error', message: 'oops', hints: [], path: ProjectPath.of('/main.typ'), from: SourceOffset.of(0), to: SourceOffset.of(1) }]);
    const status = host.querySelector('.typst-editor__status-bar [data-testid=typst-status]')!;
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
    const mark = host.querySelector<HTMLElement>('.ProseMirror .typst-diagnostics__highlight')!;
    expect(mark.textContent).toBe('world');
    expect(mark.dataset.severity).toBe('error');
    expect(mark.title).toBe('unknown variable: foo\nhint: did you mean bar?');
    editor.open('/a.typ');
    const shown = [...host.querySelectorAll<HTMLElement>('.typst-editor__pane')].find((pane) => !pane.hidden)!;
    expect(shown.querySelector<HTMLElement>('.typst-diagnostics__highlight')?.dataset.severity).toBe('warning');
  });

  it('fills the preview toolbar: "Follow cursor", zoom, page number, then "Download PDF" while pdfExport.download is on', () => {
    const { editor, preview } = setup({ source: '= Hi' });
    const all = ['typst-preview-sync__follow', 'typst-preview-zoom', 'typst-preview-page-number', 'typst-pdf'];
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
    expect(preview.revealed.at(-1)).toEqual(['/main.typ', { from: 3, to: 3 }]);
  });

  it('offers "Save to <label>…" in the tab bar for a registered source control: asks for the message, commits, says while busy', async () => {
    const changed = new EventEmitter<void>();
    const committed: string[] = [];
    const gitlab: SourceControl & { state: SourceControlState } = {
      id: 'gitlab',
      label: 'GitLab',
      defaultCommitMessage: 'Edit via Typst editor',
      state: { busy: false },
      onDidChange: changed.event,
      commit(message) {
        committed.push(message);
        this.state = { busy: true };
        changed.fire();
      },
    };
    let registration: Disposable | undefined;
    // what the collaboration extension does for a GitLab room; source-control knows only the registry
    const room: TypstExtension = {
      id: 'room',
      activate: ({ scm, subscriptions }) => subscriptions.push((registration = scm.registerSourceControl(gitlab))),
    };
    const { host } = setup({ source: '= Hi', extensions: (builtinExtensions) => [...builtinExtensions, room] });
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

    gitlab.state = { busy: false };
    changed.fire();
    expect(action()!.textContent).toBe('Save to GitLab…');

    registration!.dispose();
    expect(action()).toBeNull();
  });

  it('removes the file panel while files.panel is hide (the left side keeps Help)', () => {
    const { host, editor } = setup({ source: '= Hi', files: { '/a.typ': 'A' } });
    const button = (id: string) => host.querySelector<HTMLElement>(`[data-testid=typst-panel-toggle-${id}]`)!;
    expect(button('files').hidden).toBe(false);
    editor.settings = { 'files.panel': 'hide' };
    expect(button('files').hidden).toBe(true);
    expect(button('help').hidden).toBe(false);
    editor.settings = {};
    expect(button('files').hidden).toBe(false);
  });

  it('keeps the preview in step (preview-sync): it follows the focused selection, and a click selects its source', () => {
    const { preview, source } = setup({ source: '= Hi\n\nText\n', settings: { 'previewSync.followCursor': true } });
    source().dispatch({ selection: { anchor: 2 } });
    expect(preview.revealed).toEqual([]);
    source().focus();
    source().dispatch({ selection: { anchor: 3 } });
    expect(preview.revealed.at(-1)).toEqual(['/main.typ', { from: 3, to: 3 }]);
    preview.click({ path: ProjectPath.of('/main.typ'), from: SourceOffset.of(6), to: SourceOffset.of(10) });
    expect(source().state.selection.main).toMatchObject({ from: 6, to: 10 });
  });

  it("removes a click's outline in the preview with the next edit (any view) or once the selection moves away", () => {
    const { editor, preview, source } = setup({ source: '= Hi\n\nText more\n' });
    const click = { path: ProjectPath.of('/main.typ'), from: SourceOffset.of(6), to: SourceOffset.of(10) };
    preview.click(click);
    // selecting the clicked range (also again, as a focus may) keeps it
    source().dispatch({ selection: { anchor: 6, head: 10 } });
    expect(preview.cleared).toBe(0);
    source().dispatch({ selection: { anchor: 2 } });
    expect(preview.cleared).toBe(1);
    // once gone, nothing is removed again
    source().dispatch({ selection: { anchor: 3 } });
    expect(preview.cleared).toBe(1);

    preview.click(click);
    expect(preview.cleared).toBe(1);
    source().dispatch({ changes: { from: 0, to: 0, insert: '!' }, selection: { anchor: 7, head: 11 } });
    expect(preview.cleared).toBe(2);

    // an edit from elsewhere (another editor, the API) too
    preview.click(click);
    editor.files = { '/main.typ': '= Hi\n\nOther\n' };
    expect(preview.cleared).toBe(3);
  });

  it('shades the selection of the shown file in the preview (Source or Visual editor) once it rests, and clears it when collapsed', () => {
    vi.useFakeTimers();
    try {
      const { preview, source } = setup({ source: '= Hi\n\nText more\n', settings: { 'previewSync.followCursor': false } });
      // a drag: only where it rests is shaded
      source().dispatch({ selection: { anchor: 6, head: 8 } });
      source().dispatch({ selection: { anchor: 6, head: 10 } });
      expect(preview.shaded).toEqual([]);
      vi.advanceTimersByTime(100);
      expect(preview.shaded).toEqual([['/main.typ', [{ from: 6, to: 10 }]]]);
      source().dispatch({ selection: { anchor: 7 } });
      expect(preview.shaded.at(-1)).toEqual(['/main.typ', []]);
      // the Visual editor: its selection in the source
      const { preview: visual, host } = setup({ viewType: VISUAL_EDITOR, source: 'Hello world.\n' });
      const tiptap = (host.querySelector('.ProseMirror') as HTMLElement & { editor: { commands: { setTextSelection(range: { from: number; to: number }): void } } }).editor;
      tiptap.commands.setTextSelection({ from: 7, to: 12 });
      vi.advanceTimersByTime(100);
      expect(visual.shaded.at(-1)).toEqual(['/main.typ', [{ from: 6, to: 11 }]]);
      tiptap.commands.setTextSelection({ from: 3, to: 3 });
      expect(visual.shaded.at(-1)).toEqual(['/main.typ', []]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not shade what a click in the preview selected (its outline marks it), nor anything while previewSync.highlightSelection is off", () => {
    vi.useFakeTimers();
    try {
      const { editor, preview, source } = setup({ source: '= Hi\n\nText more\n' });
      preview.click({ path: ProjectPath.of('/main.typ'), from: SourceOffset.of(6), to: SourceOffset.of(10) });
      vi.advanceTimersByTime(100);
      expect(preview.shaded).toEqual([]);
      // moved on: the outline goes, the new selection is shaded
      source().dispatch({ selection: { anchor: 6, head: 15 } });
      vi.advanceTimersByTime(100);
      expect(preview.cleared).toBe(1);
      expect(preview.shaded).toEqual([['/main.typ', [{ from: 6, to: 15 }]]]);
      editor.settings = { 'previewSync.highlightSelection': false };
      expect(preview.shaded.at(-1)).toEqual(['/main.typ', []]);
      source().dispatch({ selection: { anchor: 0, head: 4 } });
      vi.advanceTimersByTime(100);
      expect(preview.shaded).toHaveLength(2);
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
    const blob = await editor.exportPdf({ 'comments.include': true });
    expect(blob.type).toBe('application/pdf');
    expect(exportPdf).toHaveBeenCalledWith({ main: '/main.typ', sources: {} });
    await expect(editor.exportPdf({ nope: true })).rejects.toThrow('Unknown PDF export option: nope');
  });

  it("runs the host's own extensions with the built-ins, with their settings, and leaves out built-ins by id", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const seen: unknown[] = [];
    const counter: TypstExtension = {
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
    expect(toolbarControls(preview.toolbarItems)).toEqual(['typst-preview-zoom', 'typst-preview-page-number']);
    // pdfExport.download is declared, but previewSync.followCursor is not without preview-sync
    setup({ source: '= Hi', settings: { 'previewSync.followCursor': false }, extensions: (builtinExtensions) => builtinExtensions.filter((e) => e.id !== 'preview-sync') });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown setting previewSync.followCursor'));
    warn.mockRestore();
  });

  it('finds with search everywhere what the built-ins offer, a group each, in their order', async () => {
    const source = '#import "styles.typ": note\n= Results <results>\n#figure(table(columns: 1)[a], caption: [Runs])\nCold #margin-note[- *Ada* (2026-10-10): Results?]\n';
    const { host, editor } = setup({ source, files: { '/styles.typ': '/// @style block Note\n#let note(body) = block(body)\n', '/data.csv': 'results,1\n' } });
    await editor.executeCommand('workbench.action.searchEverywhere', 'results');
    await vi.waitFor(() => expect(host.querySelector('.typst-quick-pick__progress')!.hasAttribute('hidden')).toBe(true));
    const headings = [...host.querySelectorAll('.typst-quick-pick__heading')].map((heading) => heading.firstChild!.textContent);
    expect(headings).toEqual(['Headings', 'Labels', 'Comments', 'Text']);
    await editor.executeCommand('workbench.action.searchEverywhere', '');
    const all = [...host.querySelectorAll('.typst-quick-pick__heading')].map((heading) => heading.firstChild!.textContent);
    expect(all).toEqual(['Files', 'Headings', 'Labels', 'Figures', 'Commands', 'Styles', 'Comments', 'Settings']);
  });

  it('removes everything it added on dispose', () => {
    const { host, editor } = setup({ source: '= Hi', files: { '/a.typ': 'A' } });
    editor.dispose();
    expect(host.children).toHaveLength(0);
    expect(host.classList.contains('typst-editor')).toBe(false);
  });
});

describe('collaboration', () => {
  it('shows "Connecting to the room…" over the editing area, which takes no input, until the room\'s text is there', async () => {
    const room = new Y.Doc();
    const shared = new Y.Text();
    room.getMap<Y.Text>(FILES_MAP).set('/main.typ', shared);
    shared.insert(0, 'Room text');
    const { host, source } = setup({ source: 'Local text', extensions: (builtins) => [...builtins, collaboration({ doc: room })] });
    const area = host.querySelector('.typst-editor__editor-area')!;
    expect(host.querySelector('[data-testid=typst-editing-progress] [role=status]')?.textContent).toBe('Connecting to the room…');
    expect(area.hasAttribute('inert')).toBe(true);
    await vi.waitFor(() => expect(host.querySelector('[data-testid=typst-editing-progress]')).toBeNull());
    expect(area.hasAttribute('inert')).toBe(false);
    expect(source().state.doc.toString()).toBe('Room text');
  });
});
