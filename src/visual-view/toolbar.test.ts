// @vitest-environment jsdom
import './jsdom-setup';
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../document/typst-document';
import { VisualView } from './visual-view';

function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = new VisualView(parent, doc);
  const toolbar = parent.querySelector<HTMLElement>('[role="toolbar"]')!;
  const button = (label: string) => toolbar.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const style = toolbar.querySelector<HTMLSelectElement>('select')!;
  const choose = (value: string) => {
    style.value = value;
    style.dispatchEvent(new Event('change', { bubbles: true }));
  };
  return { doc, view, toolbar, button, style, choose };
}

describe('Visual view toolbar', () => {
  it('is a labelled toolbar above the editor', () => {
    const { toolbar } = setup('Hello\n');
    expect(toolbar.getAttribute('aria-label')).toBe('Formatting');
    expect(toolbar.nextElementSibling?.classList.contains('typst-visual')).toBe(true);
  });

  it('bold and italic wrap the selection', () => {
    const { doc, view, button } = setup('Hello world\n');
    view.reveal(0, 'Hello world'.length);
    button('Bold').click();
    expect(doc.text).toBe('*Hello world*\n');
    expect(button('Bold').getAttribute('aria-pressed')).toBe('true');
    button('Italic').click();
    expect(doc.text).toBe('*_Hello world_*\n');
  });

  it('the paragraph style menu sets headings and back to normal text', () => {
    const { doc, view, style, choose } = setup('Hello world\n');
    view.reveal(0, 'Hello world'.length);
    expect(style.value).toBe('paragraph');
    choose('heading-2');
    expect(doc.text).toBe('== Hello world\n');
    expect(style.value).toBe('heading-2');
    choose('heading-1');
    expect(doc.text).toBe('= Hello world\n');
    choose('heading-3');
    expect(doc.text).toBe('=== Hello world\n');
    choose('paragraph');
    expect(doc.text).toBe('Hello world\n');
  });

  it('turns a paragraph into a bullet list and a numbered list', () => {
    const { doc, view, button } = setup('Hello world\n');
    view.reveal(0, 'Hello world'.length);
    button('Bulleted list').click();
    expect(doc.text).toBe('- Hello world\n');
    expect(button('Bulleted list').getAttribute('aria-pressed')).toBe('true');
    button('Numbered list').click();
    expect(doc.text).toBe('+ Hello world\n');
    button('Numbered list').click();
    expect(doc.text).toBe('Hello world\n');
  });

  it('undo and redo revert and reapply the last edit', () => {
    const { doc, view, button } = setup('Hello world\n');
    expect(button('Undo').disabled).toBe(true);
    view.reveal(0, 'Hello world'.length);
    button('Bold').click();
    expect(button('Undo').disabled).toBe(false);
    button('Undo').click();
    expect(doc.text).toBe('Hello world\n');
    button('Redo').click();
    expect(doc.text).toBe('*Hello world*\n');
  });

  it('keeps the editor focused: mousedown on a button does not steal focus', () => {
    const { button } = setup('Hello\n');
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button('Bold').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
