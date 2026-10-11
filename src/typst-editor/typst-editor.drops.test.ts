// @vitest-environment jsdom
// Tests for typst-editor.ts: project files dragged from the file panel into the Visual and the Source editor, made into
// Typst by the built-in extensions' drop edit providers (which one wins), with their imports (preview mocked: no worker
// in jsdom).
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
  '/chapters/one.typ': '= One\n',
  '/notes.txt': 'notes',
};

/** A drop of the project file `path` (a file panel row), as the browser sends it. */
function rowDrop(path: string): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: [], types: [PROJECT_PATH_TYPE], getData: (type: string) => (type === PROJECT_PATH_TYPE ? path : ''), dropEffect: 'none' } });
  return event;
}

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
    const onFilesChange = vi.fn();
    const editor = createTypstEditor(host, { viewType: VISUAL_EDITOR, files: { ...FILES, '/main.typ': 'One\n\nTwo\n' }, onFilesChange });
    vi.spyOn(ProseMirrorView.prototype, 'posAtCoords').mockReturnValue({ pos: 2, inside: -1 });
    host.querySelector('[contenteditable]')!.dispatchEvent(rowDrop('/img/logo.png'));
    expect(editor.source).toBe('One\n\n#image("img/logo.png")\n\nTwo\n');
    expect(onFilesChange.mock.calls.map(([change]) => change.path)).toEqual(['/main.typ']);
  });
});
