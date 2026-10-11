// @vitest-environment jsdom
// Tests for typst-editor.ts: references, links to labels and web links followed in the composed widget, in the Source
// and the Visual editor (⌘/Ctrl+click, Alt+Enter, the hover); preview mocked: no worker in jsdom.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import type { Editor } from '@tiptap/core';
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

const MAIN = 'See @fig:setup and #link("https://typst.app")[Typst], not @nowhere.\n\n#include "ch2.typ"\n';
const CH2 = '= Setup <setup>\n\n#figure(rect(), caption: [The measurement setup]) <fig:setup>\n';
const LABEL = CH2.indexOf('<fig:setup>');
/** ⌘ on Mac, Ctrl elsewhere: both held. */
const MOD = { ctrlKey: true, metaKey: true };

function setup(viewType?: string) {
  const host = document.body.appendChild(document.createElement('div'));
  const editor = createTypstEditor(host, { files: { '/main.typ': MAIN, '/ch2.typ': CH2 }, viewType });
  const pane = () => [...host.querySelectorAll<HTMLElement>('.typst-editor__pane')].find((p) => !p.hidden)!;
  const visual = () => (pane().querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor.view;
  const source = () => EditorView.findFromDOM(pane().querySelector<HTMLElement>('.cm-editor')!)!;
  return { host, editor, visual, source };
}

afterEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('links in the Source editor', () => {
  it('Mod+click on a reference opens the file of its label, the cursor at the label', () => {
    const { editor, source } = setup(SOURCE_EDITOR);
    const view = source();
    view.posAtCoords = () => MAIN.indexOf('@fig') + 3;
    view.contentDOM.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...MOD }));
    expect(editor.activeFile).toBe('/ch2.typ');
    expect(source().state.selection.main.head).toBe(LABEL);
  });

  it('Alt+Enter on a web link opens it in a new tab', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { source } = setup(SOURCE_EDITOR);
    const view = source();
    view.dispatch({ selection: { anchor: MAIN.indexOf('typst.app') } });
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true }));
    expect(open).toHaveBeenCalledWith('https://typst.app/', '_blank', 'noopener');
  });
});

describe('links in the Visual editor', () => {
  /** The position of the reference chip to `target`. */
  function chipAt(view: ReturnType<ReturnType<typeof setup>['visual']>, target: string): number {
    let at = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'reference' && node.attrs.target === target) at = pos;
    });
    return at;
  }

  it('hovering a reference says where it leads; with Mod held it shows as a link; Mod+click goes there', () => {
    const { editor, host, visual } = setup();
    const view = visual();
    const at = chipAt(view, 'fig:setup');
    view.posAtCoords = () => ({ pos: at, inside: at });
    const chip = host.querySelector<HTMLElement>('[data-target="fig:setup"]')!;
    chip.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(view.dom.title).toMatch(/^Go to Figure · The measurement setup in ch2\.typ \((⌘|Ctrl)\+click or Alt\+Enter\)$/);
    expect(view.dom.classList.contains('typst-visual--link')).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ...MOD }));
    expect(view.dom.classList.contains('typst-visual--link')).toBe(true);
    chip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    expect(editor.activeFile).toBe('/main.typ'); // a plain click edits
    chip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...MOD }));
    expect(editor.activeFile).toBe('/ch2.typ');
  });

  it('a reference to a missing label leads nowhere: the chip keeps its own tooltip', () => {
    const { host, visual } = setup();
    const view = visual();
    const at = chipAt(view, 'nowhere');
    view.posAtCoords = () => ({ pos: at, inside: at });
    host.querySelector('[data-target="nowhere"]')!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(view.dom.hasAttribute('title')).toBe(false);
    expect(host.querySelector<HTMLElement>('[data-target="nowhere"]')!.title).toContain('no label <nowhere>');
  });

  it('Alt+Enter on a selected reference goes to its label', () => {
    const { editor, visual } = setup();
    const view = visual();
    (view.dom as HTMLElement & { editor: Editor }).editor.commands.setNodeSelection(chipAt(view, 'fig:setup'));
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true }));
    expect(editor.activeFile).toBe('/ch2.typ');
  });

  it('Mod+click on a link mark opens its address in a new tab', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { host, visual } = setup();
    const view = visual();
    let pos = -1;
    view.state.doc.descendants((node, at) => {
      if (node.isText && node.text?.includes('Typst')) pos = at + node.text.indexOf('Typst') + 2;
    });
    view.posAtCoords = () => ({ pos, inside: -1 });
    const anchor = host.querySelector<HTMLElement>('.typst-markup__link')!;
    anchor.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(view.dom.title).toMatch(/^Open https:\/\/typst\.app\/ \(/);
    anchor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...MOD }));
    expect(open).toHaveBeenCalledWith('https://typst.app/', '_blank', 'noopener');
  });
});
