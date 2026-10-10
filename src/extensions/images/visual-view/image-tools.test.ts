// @vitest-environment jsdom
// Tests for image-tools.ts.
import { describe, expect, it } from 'vitest';
import { Disposable } from '../../../core/disposable/disposable';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { resizedPercent } from './image-tools';
import { createVisualView, TestPrompts, type Renderings as BoxRenderer } from '../../../testing/testing';

const renderer: BoxRenderer = {
  snippet: async () => null,
  imageUrl: (path) => (path === 'cat.png' ? 'blob:cat' : null),
  onDidChange: () => new Disposable(() => {}),
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function setup(text: string, prompts?: TestPrompts) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = createVisualView(parent, doc, { renderer, prompts });
  await settle();
  const box = () => parent.querySelector<HTMLElement>('.typst-visual__image')!;
  const tools = () => box().querySelector<HTMLElement>('[role="toolbar"][aria-label="Image"]')!;
  const button = (name: string) =>
    [...tools().querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name)!;
  const picture = () => box().querySelector<HTMLImageElement>('img.typst-visual__rendering')!;
  return { doc, view, parent, box, tools, button, picture };
}

const mousedown = (target: Element) => target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
const pointer = (target: EventTarget, type: string, clientX: number) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX }));

describe('image tools', () => {
  it('clicking the picture selects the image (showing its tools) instead of its code', async () => {
    const { box, picture } = await setup('Intro\n\n#image("cat.png")\n');
    mousedown(picture());
    expect(box().classList).toContain('ProseMirror-selectednode');
    expect(box().querySelector<HTMLElement>('.typst-visual__code')!.hidden).toBe(true);
  });

  it('double-clicking the picture shows the code', async () => {
    const { box, picture } = await setup('#image("cat.png")\n');
    picture().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(box().querySelector<HTMLElement>('.typst-visual__code')!.hidden).toBe(false);
  });

  it('adds a caption, which is then typed as text, and removes it again', async () => {
    const { doc, view, button, parent } = await setup('Intro\n\n#image("cat.png", width: 50%)\n');
    button('Add caption').click();
    expect(doc.text).toBe('Intro\n\n#figure(image("cat.png", width: 50%), caption: [])\n');
    expect(parent.querySelector('figure figcaption')).not.toBeNull();
    expect(view.selection().from).toBe(doc.text.indexOf(']'));
    button('Remove caption').click();
    expect(doc.text).toBe('Intro\n\n#image("cat.png", width: 50%)\n');
  });

  it('sets a preset width as one edit of the width argument', async () => {
    const { doc, button } = await setup('#figure(image("cat.png", width: 8cm), caption: [A]) <cat>\n');
    button('Width 75%').click();
    expect(doc.text).toBe('#figure(image("cat.png", width: 75%), caption: [A]) <cat>\n');
    expect(button('Width 75%').getAttribute('aria-pressed')).toBe('true');
  });

  it('asks for the alt text and sets it; an empty one removes it', async () => {
    const prompts = new TestPrompts().answer('A cat', '');
    const { doc, button } = await setup('#image("cat.png")\n', prompts);
    button('Alt text').click();
    await settle();
    expect(prompts.asked[0].options).toMatchObject({ title: 'Alt text', prompt: 'Alt text', value: '' });
    expect(doc.text).toBe('#image("cat.png", alt: "A cat")\n');
    button('Alt text').click();
    await settle();
    expect(prompts.asked[1].options).toMatchObject({ prompt: 'Alt text (empty removes it)', value: 'A cat' });
    expect(doc.text).toBe('#image("cat.png")\n');
  });

  it('dragging a handle shows the width live and writes it as percent on release', async () => {
    const { doc, box } = await setup('#image("cat.png")\n');
    const frame = box().querySelector<HTMLElement>('.typst-visual__image-frame')!;
    Object.defineProperty(box(), 'clientWidth', { value: 400 });
    frame.getBoundingClientRect = () => new DOMRect(0, 0, 100, 50);
    const handle = frame.querySelector('[data-handle="se"]')!;
    pointer(handle, 'pointerdown', 100);
    pointer(document, 'pointermove', 200);
    expect(frame.style.width).toBe('50%');
    expect(doc.text).toBe('#image("cat.png")\n');
    pointer(document, 'pointerup', 200);
    expect(doc.text).toBe('#image("cat.png", width: 50%)\n');
    expect(frame.style.width).toBe('50%');
  });
});

describe('resizedPercent', () => {
  it('follows the handle, twice as fast for centered images, in whole percent of the text width', () => {
    const start = { width: 100, reference: 400, centered: false };
    expect(resizedPercent(start, 100, 1)).toBe(50);
    expect(resizedPercent(start, 100, -1)).toBe(1);
    expect(resizedPercent({ ...start, centered: true }, -50, -1)).toBe(50);
    expect(resizedPercent(start, 1000, 1)).toBe(100);
    expect(resizedPercent({ ...start, width: 101 }, 0, 1)).toBe(25);
  });
});
