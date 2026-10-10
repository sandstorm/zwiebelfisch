// @vitest-environment jsdom
import './jsdom-setup';
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../document/typst-document';
import { VisualView, type VisualViewOptions } from './visual-view';

function setup(text: string, options: VisualViewOptions = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = new VisualView(parent, doc, options);
  const toolbar = parent.querySelector<HTMLElement>('[role="toolbar"]')!;
  const button = (label: string) => toolbar.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const style = toolbar.querySelector<HTMLSelectElement>('select')!;
  const choose = (value: string) => {
    style.value = value;
    style.dispatchEvent(new Event('change', { bubbles: true }));
  };
  return { doc, view, toolbar, button, style, choose, parent };
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

  describe('link popover', () => {
    /** Opens the popover from the Link button, enters `value` and applies it (as Enter would). */
    function linkTo(toolbar: HTMLElement, button: (label: string) => HTMLButtonElement, value: string) {
      button('Link').click();
      const popover = toolbar.querySelector<HTMLFormElement>('form[aria-label="Link"]')!;
      expect(popover.hidden).toBe(false);
      const input = popover.querySelector('input')!;
      input.value = value;
      popover.requestSubmit();
      return { popover, input };
    }

    it('links the selection', () => {
      const { doc, view, toolbar, button } = setup('Hello world\n');
      view.reveal(6, 11);
      const { popover } = linkTo(toolbar, button, 'https://typst.app');
      expect(doc.text).toBe('Hello #link("https://typst.app")[world]\n');
      expect(popover.hidden).toBe(true);
      expect(button('Link').getAttribute('aria-pressed')).toBe('true');
    });

    it('inserts the URL as linked text where nothing is selected', () => {
      const { doc, view, toolbar, button } = setup('See  now\n');
      view.reveal(4, 4);
      linkTo(toolbar, button, 'https://typst.app');
      expect(doc.text).toBe('See https://typst.app now\n');
    });

    it('edits and removes the link under the cursor', () => {
      const source = 'A #link("https://a.org")[site] b\n';
      const { doc, view, toolbar, button } = setup(source);
      view.reveal(source.indexOf('ite'), source.indexOf('ite'));
      const { popover, input } = linkTo(toolbar, button, 'https://b.org');
      expect(doc.text).toBe('A #link("https://b.org")[site] b\n');
      button('Link').click();
      expect(input.value).toBe('https://b.org');
      popover.querySelector<HTMLButtonElement>('button[data-action="remove"]')!.click();
      expect(doc.text).toBe('A site b\n');
      expect(popover.hidden).toBe(true);
    });

    it('opens with Mod+K in the text', () => {
      const { parent, toolbar } = setup('Hello\n');
      const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
      const mac = /Mac/.test(navigator.platform);
      const event = new KeyboardEvent('keydown', { key: 'k', metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true });
      editable.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(toolbar.querySelector<HTMLFormElement>('form[aria-label="Link"]')!.hidden).toBe(false);
    });

    it('closes on Escape without changing anything', () => {
      const { doc, view, toolbar, button } = setup('Hello\n');
      view.reveal(0, 5);
      button('Link').click();
      const popover = toolbar.querySelector<HTMLFormElement>('form[aria-label="Link"]')!;
      popover.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(popover.hidden).toBe(true);
      expect(doc.text).toBe('Hello\n');
    });
  });

  it('inserts an image block from a path', () => {
    const { doc, view, toolbar, button } = setup('Text\n');
    view.reveal(4, 4);
    button('Insert image').click();
    const popover = toolbar.querySelector<HTMLFormElement>('form[aria-label="Image"]')!;
    popover.querySelector('input')!.value = 'img/logo.png';
    popover.requestSubmit();
    expect(doc.text).toBe('Text\n\n#image("img/logo.png")\n');
  });

  it('inserts an image picked from the project files', () => {
    const assets = { list: () => ['img/logo.png', '/shared/photo.jpg'], upload: async () => null };
    const { doc, view, toolbar, button } = setup('Text\n', { assets });
    view.reveal(4, 4);
    button('Insert image').click();
    const popover = toolbar.querySelector<HTMLFormElement>('form[aria-label="Image"]')!;
    const choices = [...popover.querySelectorAll<HTMLButtonElement>('button[data-path]')];
    expect(choices.map((b) => b.textContent)).toEqual(['img/logo.png', '/shared/photo.jpg']);
    choices[1].click();
    expect(popover.hidden).toBe(true);
    expect(doc.text).toBe('Text\n\n#image("/shared/photo.jpg")\n');
  });

  it('uploads an image into the project and inserts it', async () => {
    const uploaded: File[] = [];
    const assets = { list: () => [], upload: async (file: File) => (uploaded.push(file), `img/${file.name}`) };
    const { doc, view, toolbar, button } = setup('Text\n', { assets });
    view.reveal(4, 4);
    button('Insert image').click();
    const popover = toolbar.querySelector<HTMLFormElement>('form[aria-label="Image"]')!;
    const input = popover.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([new Uint8Array([1])], 'cat.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(uploaded).toEqual([file]);
    expect(doc.text).toBe('Text\n\n#image("img/cat.png")\n');
  });

  it('inserts a table and adds and deletes rows and columns', () => {
    const { doc, view, button } = setup('Text\n');
    expect(button('Add row').disabled).toBe(true);
    view.reveal(4, 4);
    button('Insert table').click();
    expect(doc.text).toBe('Text\n\n#table(\n  columns: 2,\n  [], [],\n  [], [],\n)\n');
    expect(button('Add row').disabled).toBe(false);
    button('Add row').click();
    expect(doc.text).toBe('Text\n\n#table(\n  columns: 2,\n  [], [],\n  [], [],\n  [], [],\n)\n');
    button('Add column').click();
    expect(doc.text).toContain('columns: 3,\n  [], [], [],\n');
    button('Delete column').click();
    button('Delete row').click();
    expect(doc.text).toBe('Text\n\n#table(\n  columns: 2,\n  [], [],\n  [], [],\n)\n');
  });

  it('Code marks the selection as inline code', () => {
    const { doc, view, button } = setup('Hello world\n');
    view.reveal(6, 11);
    button('Code').click();
    expect(doc.text).toBe('Hello `world`\n');
    expect(button('Code').getAttribute('aria-pressed')).toBe('true');
    button('Code').click();
    expect(doc.text).toBe('Hello world\n');
  });

  it('Code block turns the paragraph into a code block and back', () => {
    const { doc, view, button } = setup('Hello *world*\n');
    view.reveal(0, 0);
    button('Code block').click();
    expect(doc.text).toBe('```\nHello world\n```\n');
    expect(button('Code block').getAttribute('aria-pressed')).toBe('true');
    button('Code block').click();
    expect(doc.text).toBe('Hello world\n');
  });

  it('the language field of a code block sets its language tag', () => {
    const { doc, parent } = setup('Text\n\n```rust\nfn main() {}\n```\n');
    const field = parent.querySelector<HTMLInputElement>('input[aria-label="Language"]')!;
    expect(field.value).toBe('rust');
    field.value = 'python';
    field.dispatchEvent(new Event('input'));
    expect(doc.text).toBe('Text\n\n```python\nfn main() {}\n```\n');
    field.value = 'c++';
    field.dispatchEvent(new Event('input'));
    expect(field.value).toBe('c');
    expect(doc.text).toBe('Text\n\n```c\nfn main() {}\n```\n');
    field.value = '';
    field.dispatchEvent(new Event('input'));
    expect(doc.text).toBe('Text\n\n```\nfn main() {}\n```\n');
  });

  it('Table of contents inserts #outline() as its own block', () => {
    const { doc, view, button, parent } = setup('= Intro\n\nText\n');
    view.reveal(15, 15);
    button('Table of contents').click();
    expect(doc.text).toBe('= Intro\n\nText\n\n#outline()\n');
    expect(parent.querySelector('.typst-visual__outline .typst-visual__box-label')?.textContent).toBe('Table of contents');
  });

  it('keeps the editor focused: mousedown on a button does not steal focus', () => {
    const { button } = setup('Hello\n');
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button('Bold').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
