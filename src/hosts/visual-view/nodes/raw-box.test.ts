// @vitest-environment jsdom
// Tests for raw-box.ts.
import { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { VisualView, VisualViewContributions, type VisualViewContribution } from '../visual-view';

function setup(text: string, contributions: readonly VisualViewContribution[] = []) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = new VisualView(parent, doc, VisualViewContributions.from(contributions));
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
    new VisualView(parent, new TypstDocument(RAW), VisualViewContributions.from([]));
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

  it('show the contributed actions that apply to them above the code, kept up to date with the source', () => {
    const run = vi.fn();
    const actions: VisualViewContribution = {
      id: 'test',
      activate: ({ visualView }) => {
        visualView.registerBoxAction({ title: 'Make bigger', when: (node) => node.attrs.src.includes('12pt'), run });
        visualView.registerBoxAction({ title: 'Never', when: () => false, run });
      },
    };
    const { parent, box, doc } = setup(RAW, [actions]);
    const raw = parent.querySelector<HTMLElement>('.typst-visual__raw-block')!;
    const bar = raw.querySelector<HTMLElement>('.typst-visual__box-actions')!;
    expect(bar.nextElementSibling?.classList.contains('typst-visual__code')).toBe(true);
    expect([...bar.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Make bigger']);
    bar.querySelector('button')!.click();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ attrs: expect.objectContaining({ src: '#set text(size: 12pt)' }) }), expect.objectContaining({ document: doc }));
    box('.typst-visual__raw-block').dispatch({ changes: { from: 16, to: 20, insert: '14pt' } });
    expect(bar.querySelectorAll('button')).toHaveLength(0);
  });
});
