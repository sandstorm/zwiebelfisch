// @vitest-environment jsdom
import './jsdom-setup';
import type { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../document/typst-document';
import { VisualView } from './visual-view';

/** A Visual view over `text`, its toolbar, and its Tiptap editor (for typing). */
function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = new VisualView(parent, doc);
  const toolbar = parent.querySelector<HTMLElement>('[role="toolbar"]')!;
  const button = (label: string) => {
    const found = toolbar.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
    if (!found) throw new Error(`no button "${label}"`);
    return found;
  };
  const editor = (parent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
  return { doc, view, button, editor, parent };
}

/** Types `text` character by character at the selection, as the browser would (input rules run). */
function type(editor: Editor, text: string): void {
  const { view } = editor;
  for (const char of text) {
    const { from, to } = view.state.selection;
    const insert = () => view.state.tr.insertText(char, from, to);
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, char, insert));
    if (!handled) view.dispatch(insert());
  }
}

describe('page breaks and horizontal rules', () => {
  it('"Insert page break" adds #pagebreak() after the paragraph', () => {
    const { doc, view, button, parent } = setup('Hello\n');
    view.reveal(5, 5);
    button('Insert page break').click();
    expect(doc.text).toBe('Hello\n\n#pagebreak()\n');
    expect(parent.querySelector('.typst-visual__page-break')?.textContent).toBe('Page break');
  });

  it('"Horizontal rule" adds #line(length: 100%)', () => {
    const { doc, view, button, parent } = setup('Hello\n');
    view.reveal(5, 5);
    button('Horizontal rule').click();
    expect(doc.text).toBe('Hello\n\n#line(length: 100%)\n');
    expect(parent.querySelector('.typst-visual__rule hr')).not.toBeNull();
  });

  it('"---" in an empty paragraph becomes a rule', () => {
    const { doc, view, editor } = setup('Hello\n');
    view.reveal(5, 5);
    editor.commands.splitBlock();
    type(editor, '---');
    expect(doc.text).toBe('Hello\n\n#line(length: 100%)\n\n\n');
    type(editor, 'Next');
    expect(doc.text).toBe('Hello\n\n#line(length: 100%)\n\nNext\n');
  });

  it('"---" inside text stays text (an em dash in Typst is written that way, so it is escaped)', () => {
    const { doc, view, editor } = setup('Hello\n');
    view.reveal(5, 5);
    type(editor, ' ---');
    expect(editor.state.doc.child(0).type.name).toBe('paragraph');
    expect(doc.text).toBe('Hello \\-\\--\n');
  });
});

describe('block quotes', () => {
  it('"Quote" wraps the paragraph in #quote(block: true)[..] and unwraps it again', () => {
    const { doc, view, button, parent } = setup('Hello\n');
    view.reveal(2, 2);
    button('Quote').click();
    expect(doc.text).toBe('#quote(block: true)[Hello]\n');
    expect(parent.querySelector('blockquote')?.textContent).toBe('Hello');
    expect(button('Quote').getAttribute('aria-pressed')).toBe('true');
    button('Quote').click();
    expect(doc.text).toBe('Hello\n');
  });

  it('"> " at the start of a paragraph starts a quote', () => {
    const { doc, view, editor } = setup('Hello\n');
    view.reveal(5, 5);
    editor.commands.splitBlock();
    type(editor, '> Wise words');
    expect(doc.text).toBe('Hello\n\n#quote(block: true)[Wise words]\n');
  });
});
