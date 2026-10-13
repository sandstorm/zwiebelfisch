// @vitest-environment jsdom
// Tests for image-tools.ts and image-bar.ts.
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { createVisualEditor, TestPrompts } from '../../../testing/testing';

/** The project's image file the boxes show. */
const files = { '/cat.png': new Uint8Array([1]) };

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function setup(text: string, prompts?: TestPrompts) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = createVisualEditor(parent, doc, { files, prompts });
  await settle();
  const box = () => parent.querySelector<HTMLElement>('.typst-images__box')!;
  const bar = () => parent.querySelector<HTMLElement>('[role="toolbar"][aria-label="Image"]')!;
  const picture = () => box().querySelector<HTMLImageElement>('img.typst-visual__rendering')!;
  /** The image bar's button `name`, the image selected first. */
  const button = (name: string) => {
    mousedown(picture());
    return bar().querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
  };
  return { doc, view, parent, box, bar, button, picture };
}

const mousedown = (target: Element) => target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
const pointer = (target: EventTarget, type: string, clientX: number) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX }));

describe('image tools', () => {
  it('clicking the picture selects the image (showing its bar) instead of its code', async () => {
    const { box, bar, picture } = await setup('Intro\n\n#image("cat.png")\n');
    expect(bar().hidden).toBe(true);
    mousedown(picture());
    expect(box().classList).toContain('ProseMirror-selectednode');
    expect(bar().hidden).toBe(false);
    expect(box().querySelector<HTMLElement>('.typst-visual__code')!.hidden).toBe(true);
  });

  it('double-clicking the picture shows the code', async () => {
    const { box, picture } = await setup('#image("cat.png")\n');
    picture().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(box().querySelector<HTMLElement>('.typst-visual__code')!.hidden).toBe(false);
  });

  it('asks for the caption, sets it, and removes it with an empty one', async () => {
    const prompts = new TestPrompts().answer('The cat on the mat', '');
    const { doc, button } = await setup('Intro\n\n#image("cat.png", width: 50%)\n', prompts);
    button('Caption').click();
    await settle();
    expect(prompts.asked[0].options).toMatchObject({ prompt: 'Caption', value: '' });
    expect(doc.text).toBe('Intro\n\n#figure(image("cat.png", width: 50%), caption: [The cat on the mat])\n');
    button('Caption').click();
    await settle();
    expect(prompts.asked[1].options).toMatchObject({ prompt: 'Caption (empty removes it)', value: 'The cat on the mat' });
    expect(doc.text).toBe('Intro\n\n#image("cat.png", width: 50%)\n');
  });

  it('sets a preset width as one edit of the width argument, the current one pressed', async () => {
    const { doc, button } = await setup('#figure(image("cat.png", width: 8cm, height: 2cm), caption: [A]) <cat>\n');
    expect(button('Width 75%').getAttribute('aria-pressed')).toBe('false');
    button('Width 75%').click();
    expect(doc.text).toBe('#figure(image("cat.png", width: 75%, height: 2cm), caption: [A]) <cat>\n');
    expect(button('Width 75%').getAttribute('aria-pressed')).toBe('true');
  });

  it('adds the width argument to an image without one', async () => {
    const { doc, button } = await setup('#image("cat.png", alt: "A cat")\n');
    button('Width 50%').click();
    expect(doc.text).toBe('#image("cat.png", alt: "A cat", width: 50%)\n');
  });

  it('dragging a handle shows the width live and writes it as percent on release', async () => {
    const { doc, box } = await setup('#image("cat.png")\n');
    const frame = box().querySelector<HTMLElement>('.typst-images__frame')!;
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
