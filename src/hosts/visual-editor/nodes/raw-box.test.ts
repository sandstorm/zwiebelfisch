// @vitest-environment jsdom
// Tests for raw-box.ts.
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { VisualEditor, VisualEditorHost, type RawBoxPictureHost } from '../visual-editor';

function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = new VisualEditor(parent, doc, new VisualEditorHost());
  const box = (selector: string) => {
    const dom = parent.querySelector<HTMLElement>(`${selector} .cm-content`)!;
    return EditorView.findFromDOM(dom)!;
  };
  return { doc, view, parent, box };
}

function key(cm: EditorView, name: string, mod = false) {
  const mac = /Mac/.test(navigator.platform);
  const event = new KeyboardEvent('keydown', {
    key: name,
    metaKey: mod && mac,
    ctrlKey: mod && !mac,
    bubbles: true,
    cancelable: true,
  });
  cm.contentDOM.dispatchEvent(event);
  return event;
}

const RAW = '#set text(size: 12pt)\n\nHello\n';

/**
 * The `display` CodeMirror's mounted themes give `element` through its classes (rules like
 * `.ͼ1 {…}`): `!important` beats normal, later beats earlier, as in a browser.
 * jsdom's getComputedStyle ignores `!important`, and CodeMirror's base theme uses it.
 */
function cascadedDisplay(element: HTMLElement): string | null {
  const rules = [...element.ownerDocument.styleSheets].flatMap((sheet) => [...sheet.cssRules]);
  const declarations = rules
    .filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && /^\.[^\s.:>]+$/.test(rule.selectorText))
    .filter((rule) => element.classList.contains(rule.selectorText.slice(1)) && rule.style.getPropertyValue('display'))
    .map(({ style }) => ({ value: style.getPropertyValue('display'), important: style.getPropertyPriority('display') === 'important' }));
  const important = declarations.filter((d) => d.important);
  return (important.length > 0 ? important : declarations).at(-1)?.value ?? null;
}

describe('raw boxes', () => {
  it('show their Typst source in a nested code editor', () => {
    const { box } = setup(RAW);
    expect(box('.zwf-visual__raw-block').state.doc.toString()).toBe('#set text(size: 12pt)');
  });

  it('editing a raw block changes exactly that source', () => {
    const { doc, box } = setup(RAW);
    const cm = box('.zwf-visual__raw-block');
    cm.dispatch({ changes: { from: 16, to: 20, insert: '14pt' } });
    expect(doc.text).toBe('#set text(size: 14pt)\n\nHello\n');
  });

  it('editing a raw inline box changes exactly that source', () => {
    const { doc, box } = setup('See #highlight[here] now.\n');
    const cm = box('.zwf-visual__raw-inline');
    expect(cm.state.doc.toString()).toBe('#highlight[here]');
    cm.dispatch({ changes: { from: 11, to: 15, insert: 'there' } });
    expect(doc.text).toBe('See #highlight[there] now.\n');
  });

  it('follows changes made to the source elsewhere', () => {
    const { doc, box } = setup(RAW);
    const cm = box('.zwf-visual__raw-block');
    doc.setText('#set text(size: 9pt)\n\nHello\n', 'source');
    expect(cm.state.doc.toString()).toBe('#set text(size: 9pt)');
    expect(doc.text).toBe('#set text(size: 9pt)\n\nHello\n');
  });

  it('undo in a raw box undoes through the Visual editor history', () => {
    const { doc, box } = setup(RAW);
    const cm = box('.zwf-visual__raw-block');
    cm.dispatch({ changes: { from: 0, insert: '// x\n' } });
    expect(doc.text).toBe('// x\n#set text(size: 12pt)\n\nHello\n');
    expect(key(cm, 'z', true).defaultPrevented).toBe(true);
    expect(doc.text).toBe(RAW);
    expect(cm.state.doc.toString()).toBe('#set text(size: 12pt)');
  });

  it('arrow keys at the edges leave the box into the text beside it (no block-gaps extension: no caret between blocks)', () => {
    const { doc, view, box } = setup(RAW);
    const cm = box('.zwf-visual__raw-block');
    cm.dispatch({ selection: { anchor: cm.state.doc.length } });
    expect(key(cm, 'ArrowDown').defaultPrevented).toBe(true);
    expect(view.selection()).toEqual({ from: RAW.indexOf('Hello'), to: RAW.indexOf('Hello') });
    expect(doc.text).toBe(RAW);
  });

  it('Backspace in an empty box deletes it, selecting what is nearest (no block-gaps extension: the box after)', () => {
    const { doc, view, box } = setup('#set text(size: 12pt)\n\n#set par(justify: true)\n\nHello\n');
    const cm = box('.zwf-visual__raw-block');
    cm.dispatch({ changes: { from: 0, to: cm.state.doc.length } });
    expect(key(cm, 'Backspace').defaultPrevented).toBe(true);
    expect(doc.text).toBe('#set par(justify: true)\n\nHello\n');
    expect(view.selection()).toEqual({ from: 0, to: '#set par(justify: true)'.length });
  });

  it('Tab indents a raw block\'s code and stays in an inline box', () => {
    const { doc, box } = setup('#set text(size: 12pt)\n\nSee #highlight[here] now.\n');
    const block = box('.zwf-visual__raw-block');
    expect(key(block, 'Tab').defaultPrevented).toBe(true);
    expect(doc.text).toBe('  #set text(size: 12pt)\n\nSee #highlight[here] now.\n');
    const inline = box('.zwf-visual__raw-inline');
    expect(key(inline, 'Tab').defaultPrevented).toBe(true);
    expect(doc.text).toBe('  #set text(size: 12pt)\n\nSee #highlight[here] now.\n');
  });

  it("Tab indents every selected line of a raw block's code, Shift+Tab outdents them", () => {
    const source = '#let f(x) = {\nx\n}\n';
    const { doc, box } = setup(source);
    const block = box('.zwf-visual__raw-block');
    const tab = (shiftKey: boolean) => block.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }));
    block.dispatch({ selection: { anchor: 0, head: source.indexOf('}') + 1 } });
    tab(false);
    expect(doc.text).toBe('  #let f(x) = {\n  x\n  }\n');
    tab(true);
    expect(doc.text).toBe(source);
  });

  it('live in the shadow root of the Visual editor, so focus and selection are read there', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const parent = document.createElement('div');
    shadow.append(parent);
    new VisualEditor(parent, new TypstDocument(RAW), new VisualEditorHost());
    const cm = EditorView.findFromDOM(parent.querySelector<HTMLElement>('.zwf-visual__raw-block .cm-content')!)!;
    expect(cm.root).toBe(shadow);
  });

  it('inline boxes hold only inline-level boxes, so they sit on one text line', () => {
    const { parent } = setup('See #highlight[here] now.\n');
    const box = parent.querySelector<HTMLElement>('.zwf-visual__raw-inline')!;
    // A block inside the inline <span> would split it into three lines (before, block, after).
    const editor = box.querySelector<HTMLElement>('.cm-editor')!;
    expect(cascadedDisplay(editor)).toBe('inline-flex');
    for (let el = editor.parentElement; el && el !== box; el = el.parentElement) expect(el.tagName).toBe('SPAN');
    expect([...box.children].map((child) => child.tagName)).toEqual(['SPAN']);
  });

  it('backspace in an emptied box removes it', () => {
    const { doc, parent, box } = setup(RAW);
    const cm = box('.zwf-visual__raw-block');
    cm.dispatch({ changes: { from: 0, to: cm.state.doc.length } });
    key(cm, 'Backspace');
    expect(parent.querySelector('.zwf-visual__raw-block')).toBeNull();
    expect(doc.text).toBe('Hello\n');
  });

  it("picture extensions get each picture before the box listens to it: a stopped click keeps the box closed, a plain one edits", async () => {
    const { parent, sources, disposed } = setupPictures(RAW);
    const picture = await shownPicture(parent);
    expect(sources()).toEqual(['#set text(size: 12pt)']);
    picture.dispatchEvent(new MouseEvent('mousedown', { ...modifier, button: 0, cancelable: true }));
    expect(picture.hidden).toBe(false);
    picture.dispatchEvent(new MouseEvent('mousedown', { button: 0, cancelable: true }));
    expect(picture.hidden).toBe(true);
    expect(disposed).not.toHaveBeenCalled();
    const tiptap = (parent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
    tiptap.commands.setContent('<p>Gone</p>');
    expect(disposed).toHaveBeenCalledTimes(1);
  });
});

describe('rendered raw boxes', () => {
  it('draw a box again when the renderer changes only while it is near the view, else once it comes near', async () => {
    let near: (isIntersecting: boolean) => void = () => {};
    class Observer {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        near = (isIntersecting) => callback([{ isIntersecting }]);
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', Observer);
    try {
      const changed = new EventEmitter<void>();
      const render = vi.fn(async () => ({ url: 'data:image/png;base64,' }));
      const visualEditor = new VisualEditorHost();
      visualEditor.registerRawBoxRenderer(() => ({ renders: () => true, render, onDidChange: changed.event }));
      new VisualEditor(document.body.appendChild(document.createElement('div')), new TypstDocument(RAW), visualEditor);
      await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
      near(false);
      changed.fire();
      changed.fire();
      expect(render).toHaveBeenCalledTimes(1);
      near(true);
      expect(render).toHaveBeenCalledTimes(2);
      changed.fire();
      expect(render).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

const modifier = { ctrlKey: true, metaKey: true };

/** Raw boxes drawn as a picture, with a picture extension that stops a click with Ctrl or ⌘ held. */
function setupPictures(text: string) {
  const pictures: RawBoxPictureHost[] = [];
  const disposed = vi.fn();
  const visualEditor = new VisualEditorHost();
  visualEditor.registerRawBoxRenderer(() => ({ renders: () => true, render: async () => ({ url: 'data:image/png;base64,' }), onDidChange: () => new Disposable(() => {}) }));
  visualEditor.registerRawBoxPictureExtension((box) => {
    pictures.push(box);
    box.picture.addEventListener('mousedown', (event) => {
      if (event.ctrlKey) event.stopImmediatePropagation();
    });
    return new Disposable(disposed);
  });
  const parent = document.body.appendChild(document.createElement('div'));
  new VisualEditor(parent, new TypstDocument(text), visualEditor);
  return { parent, sources: () => pictures.map((box) => box.src()), disposed };
}

async function shownPicture(parent: HTMLElement): Promise<HTMLImageElement> {
  const picture = parent.querySelector<HTMLImageElement>('.zwf-visual__rendering')!;
  await vi.waitFor(() => expect(picture.hidden).toBe(false));
  return picture;
}
