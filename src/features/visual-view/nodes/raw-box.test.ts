// @vitest-environment jsdom
// Tests for raw-box.ts.
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { VisualView } from '../visual-view';

function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = new VisualView(parent, doc);
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
  let winner: { value: string; important: boolean } | null = null;
  for (const sheet of element.ownerDocument.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule) || !/^\.[^\s.:>]+$/.test(rule.selectorText)) continue;
      if (!element.classList.contains(rule.selectorText.slice(1))) continue;
      const value = rule.style.getPropertyValue('display');
      const important = rule.style.getPropertyPriority('display') === 'important';
      if (value && (!winner?.important || important)) winner = { value, important };
    }
  }
  return winner?.value ?? null;
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

  it('undo in a raw box undoes through the Visual view history', () => {
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

  it('live in the shadow root of the Visual view, so focus and selection are read there', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const parent = document.createElement('div');
    shadow.append(parent);
    new VisualView(parent, new TypstDocument(RAW));
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
});
