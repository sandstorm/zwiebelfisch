// @vitest-environment jsdom
// Tests for visual-view.ts (rendered boxes) and the host's RenderedBox (nodes/rendered-box.ts).
import { describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../../core/disposable/disposable';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { inlinePictureSize } from '../model/model';
import { createVisualView, type Renderings as BoxRenderer } from '../../../hosts/visual-view/test-support';

const MATH_DOC = 'Intro\n\n$ x^2 $\n\nOutro\n';
const SVG = '<svg viewBox="0 0 10 5"></svg>';

function fakeRenderer(overrides: Partial<BoxRenderer> = {}) {
  const listeners = new Set<() => void>();
  const renderer: BoxRenderer = {
    snippet: vi.fn(async (_from: number, _to: number, text: string) => (text.startsWith('$') ? { svg: SVG, width: 30, height: 12 } : null)),
    imageUrl: vi.fn((path: string) => (path === 'logo.png' ? 'blob:logo' : null)),
    onDidChange: (listener) => (listeners.add(listener), new Disposable(() => listeners.delete(listener))),
    ...overrides,
  };
  return { renderer, changed: () => listeners.forEach((l) => l()) };
}

async function setup(text: string, renderer: BoxRenderer) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = createVisualView(parent, doc, { renderer });
  await settle();
  return { doc, view, parent };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function parts(box: Element) {
  return { picture: box.querySelector<HTMLImageElement>('img.typst-visual__rendering'), code: box.querySelector<HTMLElement>('.typst-visual__code')! };
}

describe('rendered raw boxes', () => {
  it('show the compiled snippet of their source instead of the code', async () => {
    const { renderer } = fakeRenderer();
    const { parent } = await setup(MATH_DOC, renderer);
    const box = parent.querySelector('.typst-visual__raw-block')!;
    const { picture, code } = parts(box);
    expect(renderer.snippet).toHaveBeenCalledWith(MATH_DOC.indexOf('$'), MATH_DOC.indexOf('$') + 7, '$ x^2 $');
    expect(picture?.hidden).toBe(false);
    expect(decodeURIComponent(picture!.src)).toContain(SVG);
    expect(picture!.style.width).toBe('30pt');
    expect(code.hidden).toBe(true);
  });

  it('switch to the code while focused and back afterwards', async () => {
    const { renderer } = fakeRenderer();
    const { parent } = await setup(MATH_DOC, renderer);
    const box = parent.querySelector('.typst-visual__raw-block')!;
    const { picture, code } = parts(box);
    picture!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(code.hidden).toBe(false);
    expect(picture!.hidden).toBe(true);
    box.querySelector('.cm-content')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    expect(code.hidden).toBe(true);
    expect(picture!.hidden).toBe(false);
  });

  it('keep showing code when the source draws nothing', async () => {
    const { renderer } = fakeRenderer();
    const { parent } = await setup('#text(red)[x]\n\nHello\n', renderer);
    const { picture, code } = parts(parent.querySelector('.typst-visual__raw-block')!);
    expect(picture?.hidden ?? true).toBe(true);
    expect(code.hidden).toBe(false);
  });

  it('do not ask for snippets of rules and definitions', async () => {
    const { renderer } = fakeRenderer();
    await setup('#set text(size: 12pt)\n\n#let x = [a]\n\nHello\n', renderer);
    expect(renderer.snippet).not.toHaveBeenCalled();
  });

  it('refresh when the renderer reports a change', async () => {
    let svg = SVG;
    const { renderer, changed } = fakeRenderer({ snippet: async () => ({ svg, width: 10, height: 5 }) });
    const { parent } = await setup(MATH_DOC, renderer);
    svg = '<svg viewBox="0 0 1 1"></svg>';
    changed();
    await settle();
    expect(decodeURIComponent(parts(parent.querySelector('.typst-visual__raw-block')!).picture!.src)).toContain(svg);
  });

  it('inline: scale the snippet so its text is as big as the text around it, on one line', async () => {
    const snippet = async () => ({ svg: SVG, width: 30, height: 16.5, textHeight: 12.5, padding: 2 });
    const { renderer } = fakeRenderer({ snippet });
    const { parent } = await setup('Took #ms(6) here.\n', renderer);
    const box = parent.querySelector('.typst-visual__raw-inline')!;
    const { picture, code } = parts(box);
    expect(picture?.hidden).toBe(false);
    expect(code.hidden).toBe(true);
    const { height, margin } = inlinePictureSize({ height: 16.5, textHeight: 12.5, padding: 2 })!;
    expect(picture!.style.height).toBe(`${height}em`);
    expect(picture!.style.width).toBe('');
    expect([picture!.style.marginTop, picture!.style.marginBottom]).toEqual([`${margin}em`, `${margin}em`]);
    expect([...box.children].map((child) => child.tagName)).toEqual(['IMG', 'SPAN']);
  });

  it('show the image file of an image block, following path edits', async () => {
    const { renderer } = fakeRenderer();
    const { parent, doc } = await setup('#image("logo.png")\n\nHello\n', renderer);
    const box = parent.querySelector('.typst-visual__image')!;
    expect(parts(box).picture?.src).toBe('blob:logo');
    expect(parts(box).code.hidden).toBe(true);
    doc.setText('#image("missing.png")\n\nHello\n', 'source');
    await settle();
    expect(parts(box).picture!.hidden).toBe(true);
    expect(parts(box).code.hidden).toBe(false);
  });
});
