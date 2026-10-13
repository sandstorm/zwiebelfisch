// @vitest-environment jsdom
// Tests for typst-editor.ts: copy and paste of Typst between files in the composed widget, the imports following,
// labels the project has already renamed (preview mocked: no worker in jsdom).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { SOURCE_EDITOR } from '../hosts/source-editor/source-editor';
import googleDocs from '../extensions/word-processors/visual-editor/fixtures/google-docs.html?raw';
import libreOffice from '../extensions/word-processors/visual-editor/fixtures/libreoffice.html?raw';
import word from '../extensions/word-processors/visual-editor/fixtures/word.html?raw';
import { createTypstEditor, type TypstEditor } from './typst-editor';

vi.mock('../hosts/preview/preview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Preview: class {
    update() {}
    reveal() {}
    setSelectionHighlight() {}
    snippet = async () => null;
    onDidRender = () => ({ dispose() {} });
    onDidClickPage = () => ({ dispose() {} });
    onDidChangeDiagnostics = () => ({ dispose() {} });
    registerToolbarItem = () => ({ dispose() {} });
    registerPdfExportOption = () => ({ dispose() {} });
    registerViewOption = () => ({ dispose() {} });
    viewOptions = () => [];
    onDidChangeViewOptions = () => ({ dispose() {} });
    engineMemory = 0;
    onDidChangeEngineMemory = () => ({ dispose() {} });
    setViewOptionValues() {}
    registerRenderer = () => ({ dispose() {} });
    renderers = () => [{ id: 'pages', label: 'Pages' }];
    activeRenderer = 'pages';
    setActiveRenderer() {}
    onDidChangeRenderers = () => ({ dispose() {} });
    pdfExportOptions = () => [];
    dispose() {}
  },
}));

const FIGURE = '#figure(\n  mermaid(read("../diagrams/workbench-layout.mmd"), width: 75%),\n  caption: [The editor: …],\n)';
const A = `#import "../template.typ": mermaid\n\n= A\n\n${FIGURE}\n`;
const IMPORTS = 'application/x-typst-imports';

/** The widget with `/book/one/a.typ` (main, importing `mermaid` from `/book/template.typ`) and `/book/two/b.typ`. */
function setup(b = 'Intro\n', viewType?: string) {
  const host = document.body.appendChild(document.createElement('div'));
  const editor = createTypstEditor(host, {
    mainFile: { path: '/book/one/a.typ' },
    files: { '/book/one/a.typ': A, '/book/two/b.typ': b, '/book/template.typ': '#let mermaid(..args) = none\n' },
    viewType,
  });
  editors.push(editor);
  const pane = () => [...host.querySelectorAll<HTMLElement>('.typst-editor__pane')].find((p) => !p.hidden && p.querySelector('[contenteditable]'))!;
  /** The shown Visual editor's Tiptap editor (Tiptap keeps it on its element). */
  const visual = () => (pane().querySelector('.typst-visual') as HTMLElement & { editor: Editor }).editor;
  const source = () => EditorView.findFromDOM(pane().querySelector<HTMLElement>('.cm-editor')!)!;
  return { editor, visual, source, text: (path: string) => editor.files[path] as string };
}

/** Fires a clipboard event of `type` on `target` with `items` (type → text) as its data; returns the data after it. */
function clipboard(target: HTMLElement, type: 'copy' | 'cut' | 'paste', items: Record<string, string> = {}): Record<string, string> {
  const data = new Map(Object.entries(items));
  const clipboardData = { getData: (t: string) => data.get(t) ?? '', setData: (t: string, v: string) => void data.set(t, v), clearData: () => data.clear(), files: [], get types() {
    return [...data.keys()];
  } };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: clipboardData });
  target.dispatchEvent(event);
  return Object.fromEntries(data);
}

const undo = (target: HTMLElement) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));

const editors: TypstEditor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose();
  document.body.replaceChildren();
  sessionStorage.clear();
});

describe('copy and paste between files', () => {
  it('a figure copied in the Visual editor carries its imports; pasted into another folder\'s file, they follow, rebased', () => {
    const { editor, visual, text } = setup();
    const a = visual();
    let figure = -1;
    a.state.doc.forEach((node, offset) => {
      if (node.attrs.src === FIGURE) figure = offset;
    });
    a.view.dispatch(a.state.tr.setSelection(NodeSelection.create(a.state.doc, figure)));
    const copied = clipboard(a.view.dom, 'copy');
    expect(copied['text/plain']).toBe(FIGURE);
    expect(JSON.parse(copied[IMPORTS])).toEqual([{ module: '/book/template.typ', item: 'mermaid' }]);

    editor.open('/book/two/b.typ');
    const b = visual();
    b.commands.setTextSelection(b.state.doc.content.size - 1);
    clipboard(b.view.dom, 'paste', copied);
    expect(text('/book/two/b.typ')).toBe(`#import "/book/template.typ": mermaid\n\nIntro\n\n${FIGURE}\n`);
    undo(b.view.dom);
    expect(text('/book/two/b.typ')).toBe('Intro\n');
  });

  it('Typst pasted from elsewhere gets the import an extension declares for its name (mermaid from merman)', () => {
    const { editor, visual, text } = setup();
    editor.open('/book/two/b.typ');
    const b = visual();
    b.commands.setTextSelection(b.state.doc.content.size - 1);
    clipboard(b.view.dom, 'paste', { 'text/plain': FIGURE });
    expect(text('/book/two/b.typ')).toBe(`#import "@preview/merman:0.4.0": mermaid\n\nIntro\n\n${FIGURE}\n`);
  });

  it('adds nothing where the file imports the name already', () => {
    const { editor, visual, text } = setup('#import "@preview/merman:0.4.0": mermaid\n\nIntro\n');
    editor.open('/book/two/b.typ');
    const b = visual();
    b.commands.setTextSelection(b.state.doc.content.size - 1);
    clipboard(b.view.dom, 'paste', { 'text/plain': FIGURE });
    expect(text('/book/two/b.typ')).toBe(`#import "@preview/merman:0.4.0": mermaid\n\nIntro\n\n${FIGURE}\n`);
  });

  it('the Source editor adds the imports of a paste, in the same undo step', () => {
    const { editor, source, text } = setup('Intro\n', SOURCE_EDITOR);
    editor.open('/book/two/b.typ');
    const b = source();
    b.dispatch({ selection: { anchor: b.state.doc.length } });
    clipboard(b.contentDOM, 'paste', { 'text/plain': `\n${FIGURE}\n`, [IMPORTS]: JSON.stringify([{ module: '/book/template.typ', item: 'mermaid' }]) });
    expect(text('/book/two/b.typ')).toBe(`#import "/book/template.typ": mermaid\n\nIntro\n\n${FIGURE}\n`);
    undo(b.contentDOM);
    expect(text('/book/two/b.typ')).toBe('Intro\n');
  });
});

const LABELLED = '#figure(rect(), caption: [B]) <fig:b>';
const B = `${LABELLED}\n\nSee @fig:b.\n`;

describe('pasted labels', () => {
  it('a label the project has gets -1, then -2, and the references in the paste with it, in the paste\'s undo step (Visual editor)', () => {
    const { editor, visual, text } = setup(B);
    editor.open('/book/two/b.typ');
    const b = visual();
    const pasted = `${LABELLED}\n\nAgain @fig:b, not @other.`;
    const once = `${B}\n#figure(rect(), caption: [B]) <fig:b-1>\n\nAgain @fig:b-1, not @other.\n`;
    b.commands.setTextSelection(b.state.doc.content.size - 1);
    clipboard(b.view.dom, 'paste', { 'text/plain': pasted });
    expect(text('/book/two/b.typ')).toBe(once);
    undo(b.view.dom);
    expect(text('/book/two/b.typ')).toBe(B);
    for (const _ of [1, 2]) {
      b.commands.setTextSelection(b.state.doc.content.size - 1);
      clipboard(b.view.dom, 'paste', { 'text/plain': pasted });
    }
    expect(text('/book/two/b.typ')).toBe(`${once}\n#figure(rect(), caption: [B]) <fig:b-2>\n\nAgain @fig:b-2, not @other.\n`);
  });

  it('a label cut and pasted keeps its name (Visual editor)', () => {
    const { editor, visual, text } = setup(B);
    editor.open('/book/two/b.typ');
    const b = visual();
    let figure = -1;
    b.state.doc.forEach((node, offset) => {
      if (node.attrs.label?.name === 'fig:b') figure = offset;
    });
    b.view.dispatch(b.state.tr.setSelection(NodeSelection.create(b.state.doc, figure)));
    const cut = clipboard(b.view.dom, 'cut');
    expect(text('/book/two/b.typ')).not.toContain('<fig:b>');
    b.commands.setTextSelection(b.state.doc.content.size - 1);
    clipboard(b.view.dom, 'paste', cut);
    expect(text('/book/two/b.typ')).toMatch(/See @fig:b\.\n\n#figure\(rect\(\), caption: \[B\]\) <fig:b>\n$/);
  });

  it('the Source editor renames pasted labels too, in one undo step; a cut one keeps its name', () => {
    const { editor, source, text } = setup(B, SOURCE_EDITOR);
    editor.open('/book/two/b.typ');
    const b = source();
    b.dispatch({ selection: { anchor: b.state.doc.length } });
    clipboard(b.contentDOM, 'paste', { 'text/plain': `\n${LABELLED} @fig:b\n` });
    expect(text('/book/two/b.typ')).toBe(`${B}\n#figure(rect(), caption: [B]) <fig:b-1> @fig:b-1\n`);
    undo(b.contentDOM);
    expect(text('/book/two/b.typ')).toBe(B);

    // cut (jsdom runs no CodeMirror cut handler)
    b.dispatch({ changes: { from: 0, to: LABELLED.length }, userEvent: 'delete.cut' });
    b.dispatch({ selection: { anchor: b.state.doc.length } });
    clipboard(b.contentDOM, 'paste', { 'text/plain': LABELLED });
    expect(text('/book/two/b.typ')).toBe(`\n\nSee @fig:b.\n${LABELLED}`);
  });
});

describe('paste as', () => {
  it('editor.action.pasteAs changes the last paste of the Source editor to plain text, escaped, in its undo step', async () => {
    const { editor, source, text } = setup('Intro\n', SOURCE_EDITOR);
    editor.open('/book/two/b.typ');
    const b = source();
    b.dispatch({ selection: { anchor: 'Intro'.length } });
    clipboard(b.contentDOM, 'paste', { 'text/plain': ' *x* = $y$' });
    expect(text('/book/two/b.typ')).toBe('Intro *x* = $y$\n');
    expect(b.dom.querySelector('.typst-paste-chip')?.textContent).toBe('Paste as: Typst ▾');
    await editor.executeCommand('editor.action.pasteAs', { kind: 'text.plain' });
    expect(text('/book/two/b.typ')).toBe('Intro \\*x\\* = \\$y\\$\n');
    undo(b.contentDOM);
    expect(text('/book/two/b.typ')).toBe('Intro\n');
  });

  it('pastes code of another language into the Source editor as it is first, and offers it as a code block', async () => {
    const { editor, source, text } = setup('Intro\n', SOURCE_EDITOR);
    editor.open('/book/two/b.typ');
    const b = source();
    b.dispatch({ selection: { anchor: 'Intro\n'.length } });
    clipboard(b.contentDOM, 'paste', { 'text/plain': 'x = 1', 'vscode-editor-data': '{"version":1,"mode":"python"}' });
    expect(text('/book/two/b.typ')).toBe('Intro\nx = 1');
    await editor.executeCommand('editor.action.pasteAs', { kind: 'typst.code' });
    expect(text('/book/two/b.typ')).toBe('Intro\n```python\nx = 1\n```');
  });

  it('editor.action.pasteAs changes the last paste of the Visual editor, its imports with it', async () => {
    const { editor, visual, text } = setup();
    editor.open('/book/two/b.typ');
    const b = visual();
    b.commands.setTextSelection(b.state.doc.content.size - 1);
    clipboard(b.view.dom, 'paste', { 'text/plain': FIGURE });
    expect(text('/book/two/b.typ')).toBe(`#import "@preview/merman:0.4.0": mermaid\n\nIntro\n\n${FIGURE}\n`);
    await editor.executeCommand('editor.action.pasteAs', { kind: 'text.plain' });
    // escaped, a paragraph per line, the first joining the paragraph pasted into; no import
    expect(text('/book/two/b.typ')).toMatch(/^Intro\\#figure\(\n\nmermaid\(read/);
    await editor.executeCommand('editor.action.pasteAs', { kind: 'typst' });
    expect(text('/book/two/b.typ')).toBe(`#import "@preview/merman:0.4.0": mermaid\n\nIntro\n\n${FIGURE}\n`);
    undo(b.view.dom);
    expect(text('/book/two/b.typ')).toBe('Intro\n');
  });
});

describe('Markdown pasted', () => {
  const MARKDOWN = '## Setup\n\nRun **pnpm** and see [the docs](https://typst.app/docs).\n\n- [ ] open\n- [x] done\n';

  it('goes into the Visual editor as Typst where it is clearly Markdown; the chip offers it as it is, in its undo step', async () => {
    const { editor, visual, text } = setup();
    editor.open('/book/two/b.typ');
    const b = visual();
    b.commands.setTextSelection(b.state.doc.content.size - 1);
    clipboard(b.view.dom, 'paste', { 'text/plain': MARKDOWN });
    expect(text('/book/two/b.typ')).toContain('== Setup\n\nRun *pnpm* and see #link("https://typst.app/docs")[the docs].\n\n- [ ] open\n- [x] done');
    await editor.executeCommand('editor.action.pasteAs', { kind: 'typst' });
    expect(text('/book/two/b.typ')).toContain('Run **pnpm** and see [the docs](https://typst.app/docs).');
    undo(b.view.dom);
    expect(text('/book/two/b.typ')).toBe('Intro\n');
  });

  it('ambiguous text (`*x*`) goes in as Typst; Markdown reads it as emphasis', async () => {
    const { editor, visual, text } = setup();
    editor.open('/book/two/b.typ');
    const b = visual();
    b.commands.setTextSelection('Intro'.length + 1);
    clipboard(b.view.dom, 'paste', { 'text/plain': ' a *x* b' });
    expect(text('/book/two/b.typ')).toBe('Intro a *x* b\n');
    await editor.executeCommand('editor.action.pasteAs', { kind: 'typst.markdown' });
    expect(text('/book/two/b.typ')).toBe('Intro a _x_ b\n');
  });

  it("VS Code's Markdown goes into the Visual editor as Typst, not as a code block of Markdown", () => {
    const { editor, visual, text } = setup();
    editor.open('/book/two/b.typ');
    const b = visual();
    b.commands.setTextSelection(b.state.doc.content.size - 1);
    clipboard(b.view.dom, 'paste', { 'text/plain': '# Title\n\n*x*', 'vscode-editor-data': '{"version":1,"mode":"markdown"}' });
    expect(text('/book/two/b.typ')).toBe('Intro\n\n= Title\n\n_x_\n');
  });

  it('goes into the Source editor as it is; the chip offers it as Typst', async () => {
    const { editor, source, text } = setup('Intro\n', SOURCE_EDITOR);
    editor.open('/book/two/b.typ');
    const b = source();
    b.dispatch({ selection: { anchor: 'Intro\n'.length } });
    clipboard(b.contentDOM, 'paste', { 'text/plain': '## Setup' });
    expect(text('/book/two/b.typ')).toBe('Intro\n## Setup');
    await editor.executeCommand('editor.action.pasteAs', { kind: 'typst.markdown' });
    expect(text('/book/two/b.typ')).toBe('Intro\n== Setup');
  });

  it("a web page's HTML is not read as Markdown", async () => {
    const { editor, visual, text } = setup();
    editor.open('/book/two/b.typ');
    const b = visual();
    b.commands.setTextSelection('Intro'.length + 1);
    clipboard(b.view.dom, 'paste', { 'text/plain': '**a**', 'text/html': '<span>**a**</span>' });
    await editor.executeCommand('editor.action.pasteAs', { kind: 'typst.markdown' });
    expect(text('/book/two/b.typ')).toBe('Intro\\*\\*a\\*\\*\n');
  });
});

describe('word processor HTML pasted into the Visual editor', () => {
  /** The Typst of `/book/two/b.typ` after `html` (with its text) is pasted at its end. */
  const pasted = (html: string) => {
    const { editor, visual, text } = setup();
    editor.open('/book/two/b.typ');
    const b = visual();
    b.commands.setTextSelection(b.state.doc.content.size - 1);
    clipboard(b.view.dom, 'paste', { 'text/plain': 'Results', 'text/html': html });
    return text('/book/two/b.typ');
  };

  it('Word: its list paragraphs as nested and numbered lists, no empty paragraphs', () => {
    expect(pasted(word)).toBe(
      'Intro\n\n= Results\n\nThe run took *18\u00a0ms* and _4 ms_ warm, see *Table 1*.\n\n- Cold start\n  - With fonts\n- Incremental\n\n+ Compile\n+ Measure\n',
    );
  });

  it("Google Docs: the heading's bold and the empty lines dropped, monospace text as code", () => {
    expect(pasted(googleDocs)).toBe('Intro\n\n== Results\n\nThe run took *18 ms* and _4 ms_ warm.\n\n- Cold start\n- #underline[Incremental]\n\n`typst compile` builds it.\n');
  });

  it("LibreOffice: the heading's bold and the empty paragraph dropped, monospace text as code", () => {
    expect(pasted(libreOffice)).toBe('Intro\n\n== Results\n\nThe run took *18 ms* and _4 ms_ warm, plain.\n\n- Cold start\n- #underline[Incremental]\n\n`typst compile` builds it.\n');
  });
});
