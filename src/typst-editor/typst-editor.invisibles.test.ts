// @vitest-environment jsdom
// Tests for typst-editor.ts: the invisible characters (the built-in `invisibles`) in the composed widget, in the
// Visual editor, the Source editor, raw boxes and the text files' editor; preview mocked: no worker in jsdom.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { SOURCE_EDITOR } from '../hosts/source-editor/source-editor';
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
    registerViewOption = () => ({ dispose() {} });
    viewOptions = () => [];
    setViewOptionValues() {}
    pdfExportOptions = () => [];
    dispose() {}
  },
}));

// jsdom lacks layout; ProseMirror only needs these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

const MAIN = 'One two  three\n\nA~B line\\\nnext\n\n#let x = 1\n';
const TOGGLE = 'invisibles.toggle';

function setup(options: { viewType?: string; settings?: Record<string, unknown> } = {}) {
  const host = document.body.appendChild(document.createElement('div'));
  const editor = createTypstEditor(host, { files: { '/main.typ': MAIN, '/notes.txt': 'a b\tc\n' }, ...options });
  const pane = () => [...host.querySelectorAll<HTMLElement>('.typst-editor__pane')].find((p) => !p.hidden)!;
  const visual = () => (pane().querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor.view;
  const count = (selector: string) => pane().querySelectorAll(selector).length;
  return { host, editor, pane, visual, count };
}

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
});

describe('invisible characters in the Visual editor', () => {
  it('are hidden by default and shown by invisibles.toggle: spaces, a non-breaking space, a line break, paragraph ends', async () => {
    const { editor, count } = setup();
    expect(count('[class^="typst-invisibles"]')).toBe(0);
    await editor.executeCommand(TOGGLE);
    expect(count('.typst-invisibles__space')).toBe(4);
    expect(count('.typst-invisibles__nbsp')).toBe(1);
    expect(count('.typst-invisibles__break')).toBe(1);
    expect(count('.typst-invisibles__paragraph')).toBe(2);
    await editor.executeCommand(TOGGLE);
    expect(count('[class^="typst-invisibles"]')).toBe(0);
  });

  it('leave the document, the text and what is copied as they are', async () => {
    const { editor, visual } = setup();
    const view = visual();
    const before = { text: view.dom.textContent, copied: view.serializeForClipboard(view.state.doc.slice(0, view.state.doc.content.size)).text };
    await editor.executeCommand(TOGGLE);
    expect(editor.source).toBe(MAIN);
    expect(view.dom.textContent).toBe(before.text);
    expect(view.serializeForClipboard(view.state.doc.slice(0, view.state.doc.content.size)).text).toBe(before.copied);
  });

  it('follow typing: the edited paragraph is marked anew, the others keep their marks', async () => {
    const { editor, visual, count } = setup();
    await editor.executeCommand(TOGGLE);
    const view = visual();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)).insertText(' four '));
    expect(editor.source.startsWith('One four  two  three')).toBe(true);
    expect(count('.typst-invisibles__space')).toBe(6);
    view.dispatch(view.state.tr.split(view.state.doc.child(0).nodeSize - 1));
    expect(count('.typst-invisibles__paragraph')).toBe(3);
    // the same as marking the whole document anew
    const marks = () => [...view.dom.querySelectorAll('[class^="typst-invisibles"]')].map((mark) => mark.className).join();
    const followed = marks();
    await editor.executeCommand(TOGGLE);
    await editor.executeCommand(TOGGLE);
    expect(marks()).toBe(followed);
  });
});

describe('invisible characters in CodeMirror', () => {
  it('show in the Source editor and in raw boxes, with the setting', async () => {
    const source = setup({ viewType: SOURCE_EDITOR });
    expect(source.count('.cm-highlightSpace')).toBe(0);
    await source.editor.executeCommand(TOGGLE);
    expect(source.count('.cm-highlightSpace')).toBeGreaterThan(0);
    expect(source.editor.source).toBe(MAIN);
    document.body.replaceChildren();

    const visual = setup({ settings: { 'invisibles.show': true } });
    expect(visual.count('.typst-visual__raw-block .cm-highlightSpace')).toBeGreaterThan(0);
  });

  it("show in the text files' editor", async () => {
    const { host, editor } = setup();
    editor.open('/notes.txt');
    const count = (selector: string) => host.querySelectorAll(`[data-testid="typst-text-file"] ${selector}`).length;
    expect(count('.cm-highlightSpace')).toBe(0);
    await editor.executeCommand(TOGGLE);
    expect(count('.cm-highlightSpace')).toBe(1);
    expect(count('.cm-highlightTab')).toBe(1);
  });
});

describe('the choice', () => {
  it("is this viewer's: kept for the next widget, unless the host's setting says otherwise", async () => {
    const first = setup();
    await first.editor.executeCommand(TOGGLE);
    first.editor.dispose();
    expect(setup().count('.typst-invisibles__space')).toBe(4);
    document.body.replaceChildren();
    expect(setup({ settings: { 'invisibles.show': false } }).count('.typst-invisibles__space')).toBe(0);
  });

  it('is a button in the tab bar, saying what it does', async () => {
    const { host, editor } = setup();
    const button = () => host.querySelector<HTMLButtonElement>(`[data-command="${TOGGLE}"]`)!;
    expect(button().title).toBe('Show invisibles');
    button().click();
    await Promise.resolve();
    expect(button().title).toBe('Hide invisibles');
    expect(editor.settings).toEqual({});
  });
});
