// @vitest-environment jsdom
// Tests for raw-box.ts.
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import type { EditorView as ProseMirrorView } from '@tiptap/pm/view';
import { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { VisualEditor, VisualEditorHost, type FollowableLink, type VisualEditorContribution } from '../visual-editor';

function setup(text: string, contributions: readonly VisualEditorContribution[] = []) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = new VisualEditor(parent, doc, VisualEditorHost.from(contributions));
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
    expect(box('.typst-visual__raw-block').state.doc.toString()).toBe('#set text(size: 12pt)');
  });

  it('editing a raw block changes exactly that source', () => {
    const { doc, box } = setup(RAW);
    const cm = box('.typst-visual__raw-block');
    cm.dispatch({ changes: { from: 16, to: 20, insert: '14pt' } });
    expect(doc.text).toBe('#set text(size: 14pt)\n\nHello\n');
  });

  it('editing a raw inline box changes exactly that source', () => {
    const { doc, box } = setup('See #highlight[here] now.\n');
    const cm = box('.typst-visual__raw-inline');
    expect(cm.state.doc.toString()).toBe('#highlight[here]');
    cm.dispatch({ changes: { from: 11, to: 15, insert: 'there' } });
    expect(doc.text).toBe('See #highlight[there] now.\n');
  });

  it('follows changes made to the source elsewhere', () => {
    const { doc, box } = setup(RAW);
    const cm = box('.typst-visual__raw-block');
    doc.setText('#set text(size: 9pt)\n\nHello\n', 'source');
    expect(cm.state.doc.toString()).toBe('#set text(size: 9pt)');
    expect(doc.text).toBe('#set text(size: 9pt)\n\nHello\n');
  });

  it('undo in a raw box undoes through the Visual editor history', () => {
    const { doc, box } = setup(RAW);
    const cm = box('.typst-visual__raw-block');
    cm.dispatch({ changes: { from: 0, insert: '// x\n' } });
    expect(doc.text).toBe('// x\n#set text(size: 12pt)\n\nHello\n');
    expect(key(cm, 'z', true).defaultPrevented).toBe(true);
    expect(doc.text).toBe(RAW);
    expect(cm.state.doc.toString()).toBe('#set text(size: 12pt)');
  });

  it('arrow keys at the edges leave the box', () => {
    const { parent, box } = setup(RAW);
    const cm = box('.typst-visual__raw-block');
    cm.dispatch({ selection: { anchor: cm.state.doc.length } });
    expect(key(cm, 'ArrowDown').defaultPrevented).toBe(true);
    const selection = parent.ownerDocument.getSelection()!;
    expect(selection.anchorNode?.textContent).toBe('Hello');
  });

  it('Tab indents a raw block\'s code and stays in an inline box; Escape, then Tab goes to the browser', () => {
    const { doc, box } = setup('#set text(size: 12pt)\n\nSee #highlight[here] now.\n');
    const block = box('.typst-visual__raw-block');
    expect(key(block, 'Tab').defaultPrevented).toBe(true);
    expect(doc.text).toBe('  #set text(size: 12pt)\n\nSee #highlight[here] now.\n');
    const inline = box('.typst-visual__raw-inline');
    expect(key(inline, 'Tab').defaultPrevented).toBe(true);
    expect(doc.text).toBe('  #set text(size: 12pt)\n\nSee #highlight[here] now.\n');
    key(block, 'Escape');
    expect(key(block, 'Tab').defaultPrevented).toBe(false);
    expect(doc.text).toBe('  #set text(size: 12pt)\n\nSee #highlight[here] now.\n');
  });

  it('live in the shadow root of the Visual editor, so focus and selection are read there', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const parent = document.createElement('div');
    shadow.append(parent);
    new VisualEditor(parent, new TypstDocument(RAW), VisualEditorHost.from([]));
    const cm = EditorView.findFromDOM(parent.querySelector<HTMLElement>('.typst-visual__raw-block .cm-content')!)!;
    expect(cm.root).toBe(shadow);
  });

  it('inline boxes hold only inline-level boxes, so they sit on one text line', () => {
    const { parent } = setup('See #highlight[here] now.\n');
    const box = parent.querySelector<HTMLElement>('.typst-visual__raw-inline')!;
    // A block inside the inline <span> would split it into three lines (before, block, after).
    const editor = box.querySelector<HTMLElement>('.cm-editor')!;
    expect(cascadedDisplay(editor)).toBe('inline-flex');
    for (let el = editor.parentElement; el && el !== box; el = el.parentElement) expect(el.tagName).toBe('SPAN');
    expect([...box.children].map((child) => child.tagName)).toEqual(['SPAN']);
  });

  it('backspace in an emptied box removes it', () => {
    const { doc, parent, box } = setup(RAW);
    const cm = box('.typst-visual__raw-block');
    cm.dispatch({ changes: { from: 0, to: cm.state.doc.length } });
    key(cm, 'Backspace');
    expect(parent.querySelector('.typst-visual__raw-block')).toBeNull();
    expect(doc.text).toBe('Hello\n');
  });

  it("pictures follow the box's link: hovered as a link (no title of their own), Mod+click; plain clicks still edit the code", async () => {
    const { parent, linkOf, follow, hover, leave } = setupLinked(RAW);
    const picture = await shownPicture(parent);
    picture.dispatchEvent(new MouseEvent('mouseenter'));
    expect(linkOf).toHaveBeenLastCalledWith('#set text(size: 12pt)', expect.any(TypstDocument));
    picture.dispatchEvent(new MouseEvent('mousemove', modifier));
    expect(hover.mock.calls.map(([event, element]) => [event.type, element])).toEqual([
      ['mouseenter', picture],
      ['mousemove', picture],
    ]);
    expect(picture.hasAttribute('title')).toBe(false);
    picture.dispatchEvent(new MouseEvent('mouseleave'));
    expect(leave).toHaveBeenCalledTimes(1);
    expect(linkOf).toHaveBeenCalledTimes(1); // once per visit
    picture.dispatchEvent(new MouseEvent('click', { ...modifier, button: 0, cancelable: true }));
    expect(follow).toHaveBeenCalledTimes(1);
    expect(picture.hidden).toBe(false);
    picture.dispatchEvent(new MouseEvent('click', { button: 0, cancelable: true }));
    expect(follow).toHaveBeenCalledTimes(1);
    expect(picture.hidden).toBe(true);
  });

  it('Alt+Enter on a selected box follows its link', () => {
    const { parent, follow } = setupLinked(RAW);
    const tiptap = (parent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
    tiptap.commands.setNodeSelection(0);
    tiptap.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true }));
    expect(follow).toHaveBeenCalledTimes(1);
    expect(parent.querySelector('.typst-visual__code')).not.toBeNull();
  });

  it('pictures of boxes without a link only say nothing and edit the code', async () => {
    const { parent, follow } = setupLinked(RAW, () => null);
    const picture = await shownPicture(parent);
    picture.dispatchEvent(new MouseEvent('mouseenter'));
    picture.dispatchEvent(new MouseEvent('mousemove'));
    expect(picture.hasAttribute('title')).toBe(false);
    picture.dispatchEvent(new MouseEvent('click', { ...modifier, button: 0, cancelable: true }));
    expect(follow).not.toHaveBeenCalled();
    expect(picture.hidden).toBe(true);
  });
});

/** The browser starting a drag of `source` (jsdom has no drag events: a plain event, a stand-in `dataTransfer`). */
function dragStart(source: Element) {
  source.dispatchEvent(dragEvent('dragstart'));
}

/** What was dragged dropped on `target`, at position `pos` of `view` (jsdom has no layout to tell it). */
function drop(view: ProseMirrorView, target: Element, pos: number) {
  const posAtCoords = vi.spyOn(view, 'posAtCoords').mockReturnValue({ pos, inside: -1 });
  target.dispatchEvent(dragEvent('drop'));
  posAtCoords.mockRestore();
}

function dragEvent(type: string): Event {
  const data = new Map<string, string>();
  const dataTransfer = { files: [], clearData: () => data.clear(), setData: (f: string, v: string) => data.set(f, v), getData: (f: string) => data.get(f) ?? '' };
  return Object.assign(new Event(type, { bubbles: true, cancelable: true }), { dataTransfer, clientX: 0, clientY: 0 });
}

describe('dragging raw boxes', () => {
  const tiptapOf = (parent: HTMLElement) => (parent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
  const press = (target: Element) => target.dispatchEvent(new Event('pointerdown', { bubbles: true }));

  it('a block box is dragged by its frame and picture, not by its code; inline boxes are not', async () => {
    const { parent } = setupLinked('#set text(size: 12pt)\n\nSee $x$.\n');
    const [block, inline] = [parent.querySelector<HTMLElement>('.typst-visual__raw-block')!, parent.querySelector<HTMLElement>('.typst-visual__raw-inline')!];
    const picture = await shownPicture(parent);
    press(picture);
    expect(block.draggable).toBe(true);
    press(block.querySelector('.cm-content')!);
    expect(block.draggable).toBe(false);
    press(block);
    expect(block.draggable).toBe(true);
    press(inline);
    expect(inline.draggable).toBe(false);
  });

  it('dropped elsewhere, a block box moves there, its Typst verbatim, in one undo step', () => {
    const text = '#set text(size: 12pt)\n\nHello\n\nWorld\n';
    const { doc, parent } = setup(text);
    const tiptap = tiptapOf(parent);
    const box = parent.querySelector<HTMLElement>('.typst-visual__raw-block')!;
    press(box);
    dragStart(box);
    expect(tiptap.view.dragging?.move).toBe(true);
    drop(tiptap.view, parent.querySelectorAll('p')[1], tiptap.state.doc.content.size);
    expect(doc.text).toBe('Hello\n\nWorld\n\n#set text(size: 12pt)\n');
    tiptap.commands.undo();
    expect(doc.text).toBe(text);
  });

  it('what the editor drags is dropped beside a box it lands on, not into its code', () => {
    const { doc, parent } = setup('Hello\n\n#let a = 1\n\n#let b = 2\n');
    const tiptap = tiptapOf(parent);
    const [first, second] = parent.querySelectorAll<HTMLElement>('.typst-visual__raw-block');
    press(first);
    dragStart(first);
    drop(tiptap.view, second.querySelector('.cm-content')!, tiptap.state.doc.content.size);
    expect(doc.text).toBe('Hello\n\n#let b = 2\n\n#let a = 1\n');
  });

  it('a drag in the code stays in the code (text, not the box)', () => {
    const { parent } = setup(RAW);
    const tiptap = tiptapOf(parent);
    const code = parent.querySelector<HTMLElement>('.typst-visual__raw-block .cm-content')!;
    press(code);
    dragStart(code);
    expect(tiptap.view.dragging).toBeNull();
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

/** Raw boxes drawn as a picture, each leading where `link` says (Ctrl or ⌘ held follows). */
function setupLinked(text: string, link: (fake: Pick<FollowableLink, 'follow' | 'hover' | 'leave'>) => FollowableLink | null = (fake) => ({ isFollowEvent: (event) => event.ctrlKey, ...fake })) {
  const follow = vi.fn();
  const hover = vi.fn<FollowableLink['hover']>();
  const leave = vi.fn<FollowableLink['leave']>();
  const linkOf = vi.fn(() => link({ follow, hover, leave }));
  const visualEditor = new VisualEditorHost({ linkOf, linkAt: () => null });
  visualEditor.registerRawBoxRenderer(() => ({ renders: () => true, render: async () => ({ url: 'data:image/png;base64,' }), onDidChange: () => new Disposable(() => {}) }));
  const parent = document.body.appendChild(document.createElement('div'));
  new VisualEditor(parent, new TypstDocument(text), visualEditor);
  return { parent, linkOf, follow, hover, leave };
}

/** The first box's picture, once it shows. */
async function shownPicture(parent: HTMLElement): Promise<HTMLImageElement> {
  const picture = parent.querySelector<HTMLImageElement>('.typst-visual__rendering')!;
  await vi.waitFor(() => expect(picture.hidden).toBe(false));
  return picture;
}
