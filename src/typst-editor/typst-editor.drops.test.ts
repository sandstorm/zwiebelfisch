// @vitest-environment jsdom
// Tests for typst-editor.ts: project files dragged from the file panel into the Visual and the Source editor, made into
// Typst by the built-in extensions' drop edit providers (which one wins), with their imports; files from the computer
// dropped there, uploaded first (preview mocked: no worker in jsdom). Files to upload are Node's (jsdom's have no
// `arrayBuffer`).
import { File as NodeFile } from 'node:buffer';
import { EditorView as CodeMirrorView } from '@codemirror/view';
import { EditorView as ProseMirrorView } from '@tiptap/pm/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SOURCE_EDITOR } from '../hosts/source-editor/source-editor';
import { VISUAL_EDITOR } from '../hosts/visual-editor/visual-editor';
import { PROJECT_PATH_TYPE } from '../hosts/workbench/workbench';
import { createTypstEditor } from './typst-editor';

vi.mock('../hosts/preview/preview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Preview: class {
    update() {}
    reveal() {}
    snippet = async () => null;
    onDidRender = () => ({ dispose() {} });
    onDidClickPage = () => ({ dispose() {} });
    onDidChangeDiagnostics = () => ({ dispose() {} });
    registerToolbarItem = () => ({ dispose() {} });
    registerPdfExportOption = () => ({ dispose() {} });
    pdfExportOptions = () => [];
    registerViewOption = () => ({ dispose() {} });
    viewOptions = () => [];
    setViewOptionValues() {}
    registerRenderer = () => ({ dispose() {} });
    renderers = () => [{ id: 'pages', label: 'Pages' }];
    activeRenderer = 'pages';
    setActiveRenderer() {}
    onDidChangeRenderers = () => ({ dispose() {} });
    onDidChangeViewOptions = () => ({ dispose() {} });
    engineMemory = 0;
    onDidChangeEngineMemory = () => ({ dispose() {} });
    setSelectionHighlight() {}
    dispose() {}
  },
}));

const BYTES = new Uint8Array([1]);
const FILES = {
  '/main.typ': 'Text\n',
  '/data/budget.ic': BYTES,
  '/data/budget.ic.gen.typ': '#let values = (\n  "Budget": (),\n)\n\n#let sheets = (\n  "Budget": table(),\n)\n',
  '/data/empty.ic': BYTES,
  '/diagrams/flow.mmd': 'flowchart LR\n  A --> B\n',
  '/diagrams/editor.drawio.png': BYTES,
  '/img/logo.png': BYTES,
  '/img/photo.png': BYTES,
  '/chapters/one.typ': '= One\n',
  '/notes.txt': 'notes',
};

/** A drop of the project file `path` (a file panel row), as the browser sends it. */
function rowDrop(path: string): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: [], types: [PROJECT_PATH_TYPE], getData: (type: string) => (type === PROJECT_PATH_TYPE ? path : ''), dropEffect: 'none' } });
  return event;
}

/** A drop of `files` from the computer, as the browser sends it. */
function desktopDrop(...files: NodeFile[]): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'], getData: () => '', dropEffect: 'none' } });
  return event;
}

const file = (name: string, content: string | Uint8Array = BYTES) => new NodeFile([content], name);

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  sessionStorage.clear();
});

describe('a project file dropped into the Source editor', () => {
  /** The main file's text after `path` was dropped at its end. */
  function dropped(path: string): string {
    const host = document.body.appendChild(document.createElement('div'));
    const editor = createTypstEditor(host, { viewType: SOURCE_EDITOR, files: FILES });
    const view = CodeMirrorView.findFromDOM(host.querySelector<HTMLElement>('.cm-editor')!)!;
    vi.spyOn(CodeMirrorView.prototype, 'posAtCoords').mockReturnValue(view.state.doc.length);
    view.contentDOM.dispatchEvent(rowDrop(path));
    const text = editor.source;
    editor.dispose();
    return text;
  }

  it('a spreadsheet, or its Typst file (over the include), is the figure of its first sheet with its import', () => {
    const figure = '#import "data/budget.ic.gen.typ": sheets\n\nText\n#figure(sheets.Budget, caption: [ ])';
    expect(dropped('/data/budget.ic')).toBe(figure);
    expect(dropped('/data/budget.ic.gen.typ')).toBe(figure);
    // no Typst file yet: no sheet to show
    expect(dropped('/data/empty.ic')).toBe('Text\n');
  });

  it('a Mermaid file is its figure with the import of merman', () => {
    expect(dropped('/diagrams/flow.mmd')).toBe('#import "@preview/merman:0.4.0": mermaid\n\nText\n#figure(mermaid(read("diagrams/flow.mmd"), width: 100%), caption: [ ])');
  });

  it('a diagram is its figure (over the plain image), an image its `#image`', () => {
    expect(dropped('/diagrams/editor.drawio.png')).toBe('Text\n#figure(image("diagrams/editor.drawio.png"), caption: [ ])');
    expect(dropped('/img/logo.png')).toBe('Text\n#image("img/logo.png")');
  });

  it('another Typst file is included; the file itself and files nobody takes insert nothing', () => {
    expect(dropped('/chapters/one.typ')).toBe('Text\n#include "chapters/one.typ"');
    expect(dropped('/main.typ')).toBe('Text\n');
    expect(dropped('/notes.txt')).toBe('Text\n');
  });
});

describe('a project file dropped into the Visual editor', () => {
  it('a spreadsheet becomes its figure after the paragraph it was dropped on, its import at the top', () => {
    const host = document.body.appendChild(document.createElement('div'));
    const editor = createTypstEditor(host, { viewType: VISUAL_EDITOR, files: { ...FILES, '/main.typ': 'One\n\nTwo\n' } });
    vi.spyOn(ProseMirrorView.prototype, 'posAtCoords').mockReturnValue({ pos: 2, inside: -1 });
    host.querySelector('[contenteditable]')!.dispatchEvent(rowDrop('/data/budget.ic'));
    expect(editor.source).toBe('#import "data/budget.ic.gen.typ": sheets\n\nOne\n\n#figure(sheets.Budget, caption: [ ])\n\nTwo\n');
  });

  it('an image is inserted where it is dropped, without an upload', () => {
    const host = document.body.appendChild(document.createElement('div'));
    const filesChanged = vi.fn();
    const editor = createTypstEditor(host, { viewType: VISUAL_EDITOR, files: { ...FILES, '/main.typ': 'One\n\nTwo\n' } });
    editor.onDidChangeFiles(filesChanged);
    vi.spyOn(ProseMirrorView.prototype, 'posAtCoords').mockReturnValue({ pos: 2, inside: -1 });
    host.querySelector('[contenteditable]')!.dispatchEvent(rowDrop('/img/logo.png'));
    expect(editor.source).toBe('One\n\n#image("img/logo.png")\n\nTwo\n');
    expect(filesChanged.mock.calls.map(([change]) => change.path)).toEqual(['/main.typ']);
  });
});

describe('a file from the computer dropped into the text', () => {
  const SPREADSHEET = { '/budget.ic': BYTES, '/budget.ic.gen.typ': FILES['/data/budget.ic.gen.typ'] };

  /** A widget showing `main` in `viewType` (a spreadsheet with its Typst file at the top), and every file change it reports. */
  function setup(viewType: string, main: string, options: Partial<Parameters<typeof createTypstEditor>[1]> = {}) {
    const host = document.body.appendChild(document.createElement('div'));
    const changes: string[] = [];
    const editor = createTypstEditor(host, { viewType, files: { ...FILES, ...SPREADSHEET, '/main.typ': main }, ...options });
    editor.onDidChangeFiles((change) => changes.push(change.path));
    return { host, editor, changes };
  }

  it('is uploaded and becomes what the drop edit providers make of it, in the Source editor at the drop position', async () => {
    const { host, editor, changes } = setup(SOURCE_EDITOR, 'One\nTwo\n');
    const view = CodeMirrorView.findFromDOM(host.querySelector<HTMLElement>('.cm-editor')!)!;
    vi.spyOn(CodeMirrorView.prototype, 'posAtCoords').mockReturnValue(4);
    const drop = desktopDrop(file('flow.mmd', 'flowchart LR\n'), file('sketch.drawio.png'), file('cat.png', new Uint8Array([2])), file('budget.ic'), file('todo.txt', 'n'));
    view.contentDOM.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(changes).toContain('/todo.txt'));
    // the spreadsheet is there already (same content): its file is used, not uploaded once more
    // images where the project's are (/img/), others at the top
    expect(changes.filter((path) => path !== '/main.typ')).toEqual(['/flow.mmd', '/img/sketch.drawio.png', '/img/cat.png', '/todo.txt']);
    expect(new TextDecoder().decode(editor.files['/flow.mmd'] as Uint8Array)).toBe('flowchart LR\n');
    expect(editor.source).toBe(
      '#import "budget.ic.gen.typ": sheets\n#import "@preview/merman:0.4.0": mermaid\n\nOne\n' +
        '#figure(mermaid(read("flow.mmd"), width: 100%), caption: [ ])#figure(image("img/sketch.drawio.png"), caption: [ ])#image("img/cat.png")#figure(sheets.Budget, caption: [ ])Two\n',
    );
    editor.dispose();
  });

  it('is uploaded and inserted in the Visual editor after the paragraph it was dropped on, in order', async () => {
    const { host, editor, changes } = setup(VISUAL_EDITOR, 'One\n\nTwo\n');
    vi.spyOn(ProseMirrorView.prototype, 'posAtCoords').mockReturnValue({ pos: 2, inside: -1 });
    const outside: Event[] = [];
    host.addEventListener('drop', (event) => outside.push(event));
    const drop = desktopDrop(file('a.png'), file('budget.ic'), file('flow.mmd', 'flowchart LR\n'));
    host.querySelector('[contenteditable]')!.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    // not uploaded once more by the file panel
    expect(outside).toEqual([]);
    await vi.waitFor(() => expect(editor.source).toContain('mermaid(read'));
    expect(changes.filter((path) => path !== '/main.typ')).toEqual(['/img/a.png', '/flow.mmd']);
    expect(editor.source).toBe(
      '#import "@preview/merman:0.4.0": mermaid\n#import "budget.ic.gen.typ": sheets\n\nOne\n\n#image("img/a.png")\n\n#figure(sheets.Budget, caption: [ ])\n\n' +
        '#figure(mermaid(read("flow.mmd"), width: 100%), caption: [ ])\n\nTwo\n',
    );
    editor.dispose();
  });

  it('a second file of the same name and other content gets a free name; a refused upload is an error message', async () => {
    const { host, editor } = setup(SOURCE_EDITOR, 'Text\n', { allowFileChange: (change) => change.path !== '/img/secret.png' });
    const view = CodeMirrorView.findFromDOM(host.querySelector<HTMLElement>('.cm-editor')!)!;
    vi.spyOn(CodeMirrorView.prototype, 'posAtCoords').mockReturnValue(5);
    view.contentDOM.dispatchEvent(desktopDrop(file('budget.ic', new Uint8Array([3])), file('secret.png')));
    await vi.waitFor(() => expect(host.textContent).toContain('This change is not allowed here.'));
    expect(Object.keys(editor.files)).toContain('/budget-2.ic');
    // no Typst file of that spreadsheet yet: no sheet to show
    expect(editor.source).toBe('Text\n');
    editor.dispose();
  });
});
