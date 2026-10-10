// @vitest-environment jsdom
// The Visual view's toolbar with the built-in extensions' items (integration: src/testing composes the built-ins).
import { describe, expect, it, vi } from 'vitest';
import { TypstDocument } from '../core/typst-document/typst-document';
import { createVisualView, TestPrompts, type TestViewOptions } from '../testing/testing';
import { PathReference } from '../core/paths/paths';

const ref = PathReference.of;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(text: string, options: TestViewOptions = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = createVisualView(parent, doc, options);
  const toolbar = parent.querySelector<HTMLElement>('[role="toolbar"]')!;
  // the formatting toolbar first, then the menus' items and the floating bars (selection, table)
  const button = (label: string) => parent.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  return { doc, view, toolbar, button, parent };
}

describe('Visual view toolbar', () => {
  it('bold and italic wrap the selection', () => {
    const { doc, view, button } = setup('Hello world\n');
    view.reveal(0, 'Hello world'.length);
    button('Bold').click();
    expect(doc.text).toBe('*Hello world*\n');
    expect(button('Bold').getAttribute('aria-pressed')).toBe('true');
    button('Italic').click();
    expect(doc.text).toBe('*_Hello world_*\n');
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

  describe('link', () => {
    /** "Link" with `answer` as the URL entered. */
    async function linkTo(button: (label: string) => HTMLButtonElement, prompts: TestPrompts, answer: string | undefined) {
      prompts.answer(answer);
      button('Link').click();
      await settle();
    }

    it('asks for the URL and links the selection', async () => {
      const prompts = new TestPrompts();
      const { doc, view, button } = setup('Hello world\n', { prompts });
      view.reveal(6, 11);
      await linkTo(button, prompts, 'https://typst.app');
      expect(prompts.asked[0].options).toMatchObject({ title: 'Link', prompt: 'URL', value: '', placeHolder: 'https://…' });
      expect(doc.text).toBe('Hello #link("https://typst.app")[world]\n');
      expect(button('Link').getAttribute('aria-pressed')).toBe('true');
    });

    it('inserts the URL as linked text where nothing is selected', async () => {
      const prompts = new TestPrompts();
      const { doc, view, button } = setup('See  now\n', { prompts });
      view.reveal(4, 4);
      await linkTo(button, prompts, 'https://typst.app');
      expect(doc.text).toBe('See https://typst.app now\n');
    });

    it('edits the link under the cursor, and an empty URL removes it', async () => {
      const source = 'A #link("https://a.org")[site] b\n';
      const prompts = new TestPrompts();
      const { doc, view, button } = setup(source, { prompts });
      view.reveal(source.indexOf('ite'), source.indexOf('ite'));
      await linkTo(button, prompts, 'https://b.org');
      expect(prompts.asked[0].options).toMatchObject({ prompt: 'URL (empty removes the link)', value: 'https://a.org' });
      expect(doc.text).toBe('A #link("https://b.org")[site] b\n');
      await linkTo(button, prompts, '');
      expect(prompts.asked[1].options).toMatchObject({ value: 'https://b.org' });
      expect(doc.text).toBe('A site b\n');
    });

    it('asks with Mod+K in the text', () => {
      const prompts = new TestPrompts();
      const { parent } = setup('Hello\n', { prompts });
      const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
      const mac = /Mac/.test(navigator.platform);
      const event = new KeyboardEvent('keydown', { key: 'k', metaKey: mac, ctrlKey: !mac, bubbles: true, cancelable: true });
      editable.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(prompts.asked).toHaveLength(1);
    });

    it('changes nothing when cancelled', async () => {
      const prompts = new TestPrompts();
      const { doc, view, button } = setup('Hello\n', { prompts });
      view.reveal(0, 5);
      await linkTo(button, prompts, undefined);
      expect(doc.text).toBe('Hello\n');
    });
  });

  it('without the project, "Insert image" asks for a path and inserts an image block', async () => {
    const prompts = new TestPrompts().answer('img/logo.png');
    const { doc, view, button } = setup('Text\n', { prompts });
    view.reveal(4, 4);
    button('Insert image').click();
    await settle();
    expect(prompts.asked[0].options).toMatchObject({ prompt: 'Image path' });
    expect(doc.text).toBe('Text\n\n#image("img/logo.png")\n');
  });

  it("offers the project's images, an upload and a path, and inserts the one picked", async () => {
    const assets = { list: () => [ref('img/logo.png'), ref('/shared/photo.jpg')], upload: async () => ({ error: 'unused' }), reference: () => null };
    const prompts = new TestPrompts().answer('/shared/photo.jpg', 'Enter a path…', 'cat.png');
    const { doc, view, button } = setup('Text\n', { assets, prompts });
    view.reveal(4, 4);
    button('Insert image').click();
    await settle();
    expect(prompts.asked[0].items!.map((item) => (typeof item === 'string' ? item : item.label))).toEqual([
      'img/logo.png',
      '/shared/photo.jpg',
      'Upload image…',
      'Enter a path…',
    ]);
    expect(doc.text).toBe('Text\n\n#image("/shared/photo.jpg")\n');
    button('Insert image').click();
    await settle();
    expect(doc.text).toContain('#image("cat.png")');
  });

  it('"Upload image…" opens the file picker; the image goes into the project and is inserted', async () => {
    const uploaded: File[] = [];
    const assets = { list: () => [], upload: async (file: File) => (uploaded.push(file), { path: ref(`img/${file.name}`) }), reference: () => null };
    const prompts = new TestPrompts().answer('Upload image…');
    const { doc, view, parent, button } = setup('Text\n', { assets, prompts });
    view.reveal(4, 4);
    const input = parent.querySelector<HTMLInputElement>('input[type="file"]')!;
    const opened = vi.spyOn(input, 'click').mockImplementation(() => {});
    button('Insert image').click();
    await settle();
    expect(opened).toHaveBeenCalled();
    const file = new File([new Uint8Array([1])], 'cat.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    await settle();
    expect(uploaded).toEqual([file]);
    expect(doc.text).toBe('Text\n\n#image("img/cat.png")\n');
  });

  it('tells why an upload was refused (an error message), and leaves the text unchanged', async () => {
    const assets = { list: () => [], upload: async () => ({ error: 'This change is not allowed here.' }), reference: () => null };
    const prompts = new TestPrompts();
    const { doc, view, parent } = setup('Text\n', { assets, prompts });
    view.reveal(4, 4);
    const input = parent.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([1])], 'cat.png')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await settle();
    expect(prompts.told).toEqual(['This change is not allowed here.']);
    expect(doc.text).toBe('Text\n');
  });

  describe('image insertion never replaces or splits content', () => {
    const SOURCE = '#set page(width: 16cm)\n#set text(size: 12pt)\n\n= Hello\n\nSome text here.\n';

    /** "Insert image" with `path` entered, in a view set up with `prompts`. */
    async function insertPath(button: (label: string) => HTMLButtonElement, prompts: TestPrompts, path: string) {
      prompts.answer(path);
      button('Insert image').click();
      await settle();
    }

    it('goes after the selected raw block (the initial selection) instead of replacing it', async () => {
      const prompts = new TestPrompts();
      const { doc, button } = setup(SOURCE, { prompts });
      await insertPath(button, prompts, 'cat.png');
      expect(doc.text).toBe('#set page(width: 16cm)\n#set text(size: 12pt)\n\n#image("cat.png")\n\n= Hello\n\nSome text here.\n');
    });

    it('goes after the heading the cursor is in instead of splitting it', async () => {
      const prompts = new TestPrompts();
      const { doc, view, button } = setup(SOURCE, { prompts });
      const at = SOURCE.indexOf('Hello') + 2;
      view.reveal(at, at);
      await insertPath(button, prompts, 'cat.png');
      expect(doc.text).toBe('#set page(width: 16cm)\n#set text(size: 12pt)\n\n= Hello\n\n#image("cat.png")\n\nSome text here.\n');
    });

    it('keeps selected text and goes after its paragraph', async () => {
      const prompts = new TestPrompts();
      const { doc, view, button } = setup(SOURCE, { prompts });
      view.reveal(SOURCE.indexOf('Some'), SOURCE.indexOf(' here'));
      await insertPath(button, prompts, 'cat.png');
      expect(doc.text).toBe(`${SOURCE}\n#image("cat.png")\n`);
    });

    it('fills an empty document', async () => {
      const prompts = new TestPrompts();
      const { doc, button } = setup('', { prompts });
      await insertPath(button, prompts, 'cat.png');
      expect(doc.text).toBe('#image("cat.png")');
    });
  });

  describe('image files dropped or pasted into the text', () => {
    const png = (name: string) => new File([new Uint8Array([1])], name, { type: 'image/png' });
    const pdf = new File(['%PDF'], 'paper.pdf', { type: 'application/pdf' });

    /** A drop / paste event carrying `files`, as the browser sends it. */
    function fileEvent(type: 'drop' | 'paste', files: File[]) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const data = { files, types: ['Files'], getData: () => '' };
      Object.defineProperty(event, type === 'drop' ? 'dataTransfer' : 'clipboardData', { value: data });
      return event;
    }

    function withUploads(error?: string) {
      const uploaded: string[] = [];
      const assets = {
        list: () => [],
        upload: async (file: File) => (error ? { error } : (uploaded.push(file.name), { path: ref(file.name) })),
        reference: (path: string) => (path.endsWith('.png') ? ref(path.slice(1)) : null),
      };
      return { assets, uploaded };
    }


    it('a pasted image is uploaded and inserted after the paragraph with the cursor', async () => {
      const { assets, uploaded } = withUploads();
      const { doc, view, parent } = setup('One\n\nTwo\n', { assets });
      view.reveal(1, 1);
      const event = fileEvent('paste', [png('shot.png')]);
      parent.querySelector('[contenteditable]')!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      await settle();
      expect(uploaded).toEqual(['shot.png']);
      expect(doc.text).toBe('One\n\n#image("shot.png")\n\nTwo\n');
    });

    it('dropped images are uploaded and inserted in order, instead of the browser opening the file', async () => {
      const { assets, uploaded } = withUploads();
      const { doc, view, parent } = setup('One\n', { assets });
      view.reveal(3, 3);
      const outside: Event[] = [];
      parent.addEventListener('drop', (e) => outside.push(e));
      const event = fileEvent('drop', [png('a.png'), pdf, png('b.png')]);
      parent.querySelector('[contenteditable]')!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(outside).toEqual([]); // not uploaded once more by the file panel
      await settle();
      expect(uploaded).toEqual(['a.png', 'b.png']);
      expect(doc.text).toBe('One\n\n#image("a.png")\n\n#image("b.png")\n');
    });

    it('leaves drops without images alone (the file panel may take them)', () => {
      const { assets } = withUploads();
      const { doc, parent } = setup('One\n', { assets });
      const event = fileEvent('drop', [pdf]);
      parent.querySelector('[contenteditable]')!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(doc.text).toBe('One\n');
    });

    it('tells why a dropped image was not added (an error message)', async () => {
      const { assets } = withUploads('This change is not allowed here.');
      const prompts = new TestPrompts();
      const { doc, parent } = setup('One\n', { assets, prompts });
      parent.querySelector('[contenteditable]')!.dispatchEvent(fileEvent('drop', [png('a.png')]));
      await settle();
      expect(prompts.told).toEqual(['This change is not allowed here.']);
      expect(doc.text).toBe('One\n');
    });

    /** A file-panel row (project path) dragged over or dropped on the text. */
    function rowEvent(type: 'dragover' | 'drop', path: string) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const data = { files: [], types: ['application/x-typst-project-path'], getData: () => path, dropEffect: 'none' };
      Object.defineProperty(event, 'dataTransfer', { value: data });
      return event;
    }

    it('an image dragged from the file panel is inserted where it is dropped, without an upload', () => {
      const { assets, uploaded } = withUploads();
      const { doc, view, parent } = setup('One\n\nTwo\n', { assets });
      view.reveal(1, 1);
      const editable = parent.querySelector('[contenteditable]')!;
      const over = rowEvent('dragover', '/img/logo.png');
      editable.dispatchEvent(over);
      expect(over.defaultPrevented).toBe(true); // the browser lets it drop
      const drop = rowEvent('drop', '/img/logo.png');
      editable.dispatchEvent(drop);
      expect(drop.defaultPrevented).toBe(true);
      expect(uploaded).toEqual([]);
      expect(doc.text).toBe('One\n\n#image("img/logo.png")\n\nTwo\n');
    });

    it('a dragged file that is no image is not inserted', () => {
      const { assets } = withUploads();
      const { doc, parent } = setup('One\n', { assets });
      parent.querySelector('[contenteditable]')!.dispatchEvent(rowEvent('drop', '/data.csv'));
      expect(doc.text).toBe('One\n');
    });

    it('without assets, dropped files are left to the browser as before', () => {
      const { parent } = setup('One\n');
      const event = fileEvent('drop', [png('a.png')]);
      parent.querySelector('[contenteditable]')!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    });
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
});
