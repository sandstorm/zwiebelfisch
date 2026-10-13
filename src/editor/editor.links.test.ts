// @vitest-environment jsdom
// Tests for editor.ts: references, links to labels and web links followed in the composed widget, in the Source
// and the Visual editor (⌘/Ctrl+click, Alt+Enter, the hover), and where the preview goes; preview mocked: no worker in
// jsdom (where its engine places a source offset: typst-engine.test.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import type { Editor } from '@tiptap/core';
import { SOURCE_EDITOR } from '../hosts/source-editor/source-editor';
import { createEditor } from './editor';

/** What the preview was asked to reveal: the file and offset. */
const revealed = vi.hoisted(() => [] as [string, number][]);

vi.mock('../hosts/preview/preview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Preview: class {
    update() {}
    reveal(path: string, { from }: { from: number }) {
      revealed.push([path, from]);
    }
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

const MAIN = 'See @fig:setup and #link("https://typst.app")[Typst], not @nowhere.\n\n#include "ch2.typ"\n';
const CH2 = '= Setup <setup>\n\n#figure(rect(), caption: [The measurement setup]) <fig:setup>\n';
const LABEL = CH2.indexOf('<fig:setup>');
/** ⌘ on Mac, Ctrl elsewhere: both held. */
const MOD = { ctrlKey: true, metaKey: true };

function setup(viewType?: string, files: Record<string, string> = { '/main.typ': MAIN, '/ch2.typ': CH2 }) {
  const host = document.body.appendChild(document.createElement('div'));
  const editor = createEditor(host, { files, viewType });
  const pane = () => [...host.querySelectorAll<HTMLElement>('.typst-editor__pane')].find((p) => !p.hidden)!;
  const visual = () => (pane().querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor.view;
  const source = () => EditorView.findFromDOM(pane().querySelector<HTMLElement>('.cm-editor')!)!;
  return { host, editor, visual, source };
}

/** The hint shown after the pointer moved over `element` and rested there; null: none. */
function hintAfterHover(element: Element, init: MouseEventInit = {}): HTMLElement | null {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ...init }));
  vi.advanceTimersByTime(300);
  vi.useRealTimers();
  return document.querySelector<HTMLElement>('.typst-link-hint[role=tooltip]');
}

/** The pointer left the editor of `element`. */
function leave(element: Element): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  element.closest('.ProseMirror, .cm-content')!.dispatchEvent(new MouseEvent('mouseleave'));
  vi.advanceTimersByTime(300);
  vi.useRealTimers();
}

afterEach(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  document.body.replaceChildren();
  sessionStorage.clear();
  vi.restoreAllMocks();
  revealed.length = 0;
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

  it('hovering a reference shows the same hint as a reference chip in the Visual editor', () => {
    const { host } = setup(SOURCE_EDITOR);
    const mark = [...host.querySelectorAll('.typst-source__path')].find((m) => m.textContent === '@fig:setup')!;
    const hint = hintAfterHover(mark)!;
    expect(hint.textContent).toMatch(/^Go to Figure · The measurement setup in ch2\.typ\((⌘|Ctrl)\+click or Alt\+Enter\)$/);
    expect(mark.hasAttribute('title')).toBe(false);
    leave(mark);
    expect(document.querySelector('.typst-link-hint')).toBeNull();
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

  it('hovering a reference shows the hint of every link; with Mod held it shows as a link; Mod+click goes there', () => {
    const { editor, host, visual } = setup();
    const view = visual();
    const at = chipAt(view, 'fig:setup');
    view.posAtCoords = () => ({ pos: at, inside: at });
    const chip = host.querySelector<HTMLElement>('[data-target="fig:setup"]')!;
    const hint = hintAfterHover(chip)!;
    expect(hint.textContent).toMatch(/^Go to Figure · The measurement setup in ch2\.typ\((⌘|Ctrl)\+click or Alt\+Enter\)$/);
    expect(chip.getAttribute('aria-describedby')).toBe(hint.id);
    expect([view.dom.hasAttribute('title'), chip.hasAttribute('title')]).toEqual([false, false]);
    expect(chip.classList.contains('typst-link--mod')).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ...MOD }));
    expect(chip.classList.contains('typst-link--mod')).toBe(true);
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
    expect(hintAfterHover(host.querySelector('[data-target="nowhere"]')!)).toBeNull();
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
    const hint = hintAfterHover(anchor)!;
    expect(hint.className).toBe('typst-link-hint');
    expect(hint.textContent).toMatch(/^Open https:\/\/typst\.app\/\(/);
    expect(anchor.hasAttribute('title')).toBe(false);
    leave(anchor);
    expect(document.querySelector('.typst-link-hint')).toBeNull();
    anchor.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...MOD }));
    expect(open).toHaveBeenCalledWith('https://typst.app/', '_blank', 'noopener');
  });
});

describe('following a reference in the Visual editor goes to its label, scrolled there, for every kind of label', () => {
  const BOOK = {
    '/main.typ': [
      '= Introduction <sec:intro>',
      'First words.',
      'See @sec:intro, @sec:method, @fig:a, @tab:b, @eq:c and @knuth.',
      '#figure(rect(), caption: [A rectangle]) <fig:a>',
      'After the figure.',
      '#figure(table(columns: 1, [x]), caption: [A table]) <tab:b>',
      'After the table.',
      '$ x = 1 $ <eq:c>',
      'After the equation.',
      '#include "method.typ"',
      '#bibliography("refs.bib")',
      '',
    ].join('\n\n'),
    '/method.typ': 'Some words first.\n\n= Method <sec:method>\n\nHow it was done.\n',
    '/refs.bib': '@book{knuth, title={The Art of Computer Programming}}\n',
  };

  /**
   * The widget showing main.typ, method.typ visited before (so its editor is there to watch), the focus in main.typ's
   * text (as after typing) or `elsewhere` (as after opening the file from the file panel).
   */
  function book(focus: 'text' | 'elsewhere') {
    const widget = setup(undefined, BOOK);
    const scrolled = new Map<string, number[]>();
    for (const path of ['/method.typ', '/main.typ']) {
      widget.editor.open(path);
      // ProseMirror scrolls to the selection the DOM has: only while that is in the editor, it asks this prop
      const seen: number[] = [];
      widget.visual().setProps({ handleScrollToSelection: (view) => seen.push(view.state.selection.head) > 0 });
      scrolled.set(path, seen);
    }
    if (focus === 'text') widget.visual().focus();
    else widget.host.appendChild(document.createElement('input')).focus();
    return { ...widget, scrolled };
  }

  /** Follows the reference chip to `target` in the shown file: Mod+click on it, or Alt+Enter on it selected. */
  function follow({ visual, host }: ReturnType<typeof book>, target: string, how: 'click' | 'key') {
    const view = visual();
    let pos = -1;
    view.state.doc.descendants((node, at) => {
      if (node.type.name === 'reference' && node.attrs.target === target) pos = at;
    });
    if (how === 'click') {
      view.posAtCoords = () => ({ pos, inside: pos });
      const chip = host.querySelector<HTMLElement>(`[data-target="${target}"]`)!;
      chip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...MOD }));
    } else {
      (view.dom as HTMLElement & { editor: Editor }).editor.commands.setNodeSelection(pos);
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true }));
    }
  }

  /** Where the cursor of the shown Visual editor is: the text of its block, and how far into it. */
  function cursor(visual: ReturnType<typeof book>['visual']) {
    const { selection, doc } = visual().state;
    const $head = doc.resolve(selection.head);
    return { empty: selection.empty, block: $head.parent.textContent, offset: $head.parentOffset };
  }

  for (const how of ['click', 'key'] as const) {
    it(`a section in another file (${how}): its file, the cursor at the end of the heading (by its label tag)`, () => {
      const widget = book('text');
      follow(widget, 'sec:method', how);
      expect(widget.editor.activeFile).toBe('/method.typ');
      expect(cursor(widget.visual)).toEqual({ empty: true, block: 'Method', offset: 'Method'.length });
      expect(widget.scrolled.get('/method.typ')).toEqual([widget.visual().state.selection.head]);
      expect(document.activeElement).toBe(widget.visual().dom);
    });

    it(`a section in the same file (${how}), the focus elsewhere before`, () => {
      const widget = book('elsewhere');
      follow(widget, 'sec:intro', how);
      expect(widget.editor.activeFile).toBe('/main.typ');
      expect(cursor(widget.visual)).toEqual({ empty: true, block: 'Introduction', offset: 'Introduction'.length });
      expect(widget.scrolled.get('/main.typ')).toEqual([widget.visual().state.selection.head]);
      expect(document.activeElement).toBe(widget.visual().dom);
    });
  }

  it.each([
    ['fig:a', 'After the figure.'],
    ['tab:b', 'After the table.'],
    ['eq:c', 'After the equation.'],
  ])('%s: the cursor right below the box (by its label tag), scrolled there', (target, below) => {
    const widget = book('elsewhere');
    follow(widget, target, 'click');
    expect(widget.editor.activeFile).toBe('/main.typ');
    expect(cursor(widget.visual)).toEqual({ empty: true, block: below, offset: 0 });
    expect(widget.scrolled.get('/main.typ')).toEqual([widget.visual().state.selection.head]);
  });

  it('a bibliography key opens the bibliography', () => {
    const widget = book('text');
    follow(widget, 'knuth', 'click');
    expect(widget.editor.activeFile).toBe('/refs.bib');
  });

  describe('the preview goes to the label, once (its engine places a label where its element starts)', () => {
    const label = (path: string, name: string) => BOOK[path as keyof typeof BOOK].indexOf(`<${name}>`);

    for (const how of ['click', 'key'] as const) {
      it.each([
        ['sec:method', '/method.typ'],
        ['sec:intro', '/main.typ'],
        ['fig:a', '/main.typ'],
        ['tab:b', '/main.typ'],
        ['eq:c', '/main.typ'],
      ])(`Visual editor, %s (${how})`, (target, path) => {
        const widget = book('elsewhere');
        revealed.length = 0;
        follow(widget, target, how);
        expect(revealed).toEqual([[path, label(path, target)]]);
      });
    }

    it.each([
      ['sec:method', '/method.typ', 'text'],
      ['fig:a', '/main.typ', 'text'],
      ['sec:intro', '/main.typ', 'elsewhere'],
    ] as const)('Source editor, %s in %s (Alt+Enter; the focus in the %s before)', (target, path, focus) => {
      const widget = setup(SOURCE_EDITOR, BOOK);
      widget.editor.open('/method.typ');
      widget.editor.open('/main.typ');
      const view = widget.source();
      view.dispatch({ selection: { anchor: BOOK['/main.typ'].indexOf(`@${target}`) + 2 } });
      if (focus === 'text') view.focus();
      revealed.length = 0;
      view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true }));
      expect(revealed).toEqual([[path, label(path, target)]]);
    });
  });
});
