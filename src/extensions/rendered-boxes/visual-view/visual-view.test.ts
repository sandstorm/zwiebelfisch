// @vitest-environment jsdom
// Tests for visual-view.ts (rendered boxes) and the host's RenderedBox (nodes/rendered-box.ts), with the images'
// renderer drawing image boxes.
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import type { ProjectPath } from '../../../core/paths/paths';
import { Pt } from '../../../core/typst-engine/typst-engine';
import { type SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';
import type { PreviewContributions } from '../../../hosts/preview/preview';
import { inlinePictureSize } from '../model/model';
import { createVisualView } from '../../../testing/testing';

const MATH_DOC = 'Intro\n\n$ x^2 $\n\nOutro\n';
const SVG = '<svg viewBox="0 0 10 5"></svg>';

type Preview = Pick<PreviewContributions, 'snippet' | 'onDidRender'>;

/** A preview whose snippets are an equation's (`snippet` replaces them); `changed` fires its `onDidRender`. */
function fakeRenderer(overrides: Partial<Preview> = {}) {
  const rendered = new EventEmitter<void>();
  const renderer = {
    snippet: vi.fn(async (_path: ProjectPath, _range: SourceRange, text: string) => (text.startsWith('$') ? { svg: SVG, width: Pt.of(30), height: Pt.of(12), textHeight: Pt.of(12), padding: Pt.of(0) } : null)),
    onDidRender: rendered.event,
    ...overrides,
  };
  return { renderer, changed: () => rendered.fire() };
}

async function setup(text: string, preview: Preview) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = createVisualView(parent, doc, { preview, files: { '/logo.png': new Uint8Array([1]) } });
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
    expect(renderer.snippet).toHaveBeenCalledWith('/main.typ', { from: MATH_DOC.indexOf('$'), to: MATH_DOC.indexOf('$') + 7 }, '$ x^2 $');
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
    const { renderer, changed } = fakeRenderer({ snippet: async () => ({ svg, width: Pt.of(10), height: Pt.of(5), textHeight: Pt.of(5), padding: Pt.of(0) }) });
    const { parent } = await setup(MATH_DOC, renderer);
    svg = '<svg viewBox="0 0 1 1"></svg>';
    changed();
    await settle();
    expect(decodeURIComponent(parts(parent.querySelector('.typst-visual__raw-block')!).picture!.src)).toContain(svg);
  });

  it('inline: scale the snippet so its text is as big as the text around it, on one line', async () => {
    const snippet = async () => ({ svg: SVG, width: Pt.of(30), height: Pt.of(16.5), textHeight: Pt.of(12.5), padding: Pt.of(2) });
    const { renderer } = fakeRenderer({ snippet });
    const { parent } = await setup('Took #ms(6) here.\n', renderer);
    const box = parent.querySelector('.typst-visual__raw-inline')!;
    const { picture, code } = parts(box);
    expect(picture?.hidden).toBe(false);
    expect(code.hidden).toBe(true);
    const { height, margin } = inlinePictureSize({ height: Pt.of(16.5), textHeight: Pt.of(12.5), padding: Pt.of(2) })!;
    expect(picture!.style.height).toBe(`${height}em`);
    expect(picture!.style.width).toBe('');
    expect([picture!.style.marginTop, picture!.style.marginBottom]).toEqual([`${margin}em`, `${margin}em`]);
    expect([...box.children].map((child) => child.tagName)).toEqual(['IMG', 'SPAN']);
  });

  it('show the image file of an image block, following path edits', async () => {
    const { renderer } = fakeRenderer();
    const { parent, doc } = await setup('#image("logo.png")\n\nHello\n', renderer);
    const box = parent.querySelector('.typst-images__box')!;
    expect(parts(box).picture?.src).toMatch(/^blob:/);
    expect(parts(box).code.hidden).toBe(true);
    doc.setText('#image("missing.png")\n\nHello\n', 'source');
    await settle();
    expect(parts(box).picture!.hidden).toBe(true);
    expect(parts(box).code.hidden).toBe(false);
  });
});
