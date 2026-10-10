// @vitest-environment jsdom
// Tests for box-links.ts.
import { describe, expect, it, vi } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import type { FileLinks } from '../../../core/project/project';
import { VisualView } from '../visual-view';

function setup(text: string) {
  const files = new Set(['/main.typ', '/template.typ', '/logo.png']);
  const links: FileLinks = {
    resolve: (reference) => `/${reference}`,
    exists: (path) => files.has(path),
    open: vi.fn(),
    create: vi.fn(async (path: string) => (files.add(path), null)),
  };
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  new VisualView(parent, doc, { links });
  return { parent, links, doc, files };
}

const buttons = (root: Element) => [...root.querySelectorAll('button')].map((b) => b.textContent);

describe('file links in the Visual view', () => {
  it('a raw block naming files shows "Open …" for each, and opens it on click', () => {
    const { parent, links } = setup('#import "template.typ": template\n\nHello\n');
    const row = parent.querySelector('.typst-visual__raw-block .typst-visual__box-links')!;
    expect(buttons(row)).toEqual(['Open template.typ']);
    row.querySelector('button')!.click();
    expect(links.open).toHaveBeenCalledWith('/template.typ');
  });

  it('a missing Typst file can be created; the row follows edits', async () => {
    const { parent, links, doc } = setup('#include "appendix.typ"\n\nHello\n');
    const row = parent.querySelector<HTMLElement>('.typst-visual__box-links')!;
    expect(row.textContent).toContain('appendix.typ is not in the project');
    row.querySelector('button')!.click();
    expect(links.create).toHaveBeenCalledWith('/appendix.typ');
    row.closest('.typst-visual__raw-block')!.dispatchEvent(new Event('pointerenter'));
    expect(buttons(row)).toEqual(['Open appendix.typ']);
    doc.setText('#set text(size: 12pt)\n\nHello\n', 'test');
    expect(parent.querySelector<HTMLElement>('.typst-visual__box-links')!.hidden).toBe(true);
  });

  it('raw blocks without paths show no links', () => {
    const { parent } = setup('#set text(size: 12pt)\n\nHello\n');
    expect(parent.querySelector<HTMLElement>('.typst-visual__box-links')!.hidden).toBe(true);
  });

  it("an image box's path in its heading opens the image", () => {
    const { parent, links } = setup('#image("logo.png")\n\nHello\n');
    const label = parent.querySelector('.typst-visual__image-label')!;
    expect(label.textContent).toBe('Image: logo.png');
    label.querySelector<HTMLButtonElement>('button.typst-visual__path')!.click();
    expect(links.open).toHaveBeenCalledWith('/logo.png');
  });

  it("a missing image's path is marked, not a link", () => {
    const { parent } = setup('#image("gone.png")\n\nHello\n');
    const label = parent.querySelector('.typst-visual__image-label')!;
    expect(label.querySelector('button')).toBeNull();
    expect(label.querySelector('.typst-visual__path--missing')!.getAttribute('title')).toBe('gone.png is not in the project');
  });
});
