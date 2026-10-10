// @vitest-environment jsdom
import './jsdom-setup';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../document/typst-document';
import { VisualView } from './visual-view';

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

  it('backspace in an emptied box removes it', () => {
    const { doc, parent, box } = setup(RAW);
    const cm = box('.typst-visual__raw-block');
    cm.dispatch({ changes: { from: 0, to: cm.state.doc.length } });
    key(cm, 'Backspace');
    expect(parent.querySelector('.typst-visual__raw-block')).toBeNull();
    expect(doc.text).toBe('Hello\n');
  });
});
