// @vitest-environment jsdom
// Tests for visual-view.ts (file links in raw boxes) and the image box's path link.
import { describe, expect, it, vi } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { DocumentLinkProvider, type LinkWorkspace } from '../../../core/document-links/document-links';
import { createVisualView } from '../../../testing/testing';
import { ProjectPath } from '../../../core/paths/paths';

const path = ProjectPath.of;

function setup(text: string) {
  const files = new Set(['/main.typ', path('/template.typ'), path('/logo.png')]);
  const links: LinkWorkspace = {
    resolve: (reference) => ProjectPath.resolve(path('/main.typ'), reference),
    exists: (path) => files.has(path),
    open: vi.fn(),
    create: vi.fn(async (path: string) => (files.add(path), null)),
  };
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  createVisualView(parent, doc, { documentLinks: new DocumentLinkProvider(links) });
  return { parent, links, doc, files };
}

const buttons = (root: Element) => [...root.querySelectorAll('button')].map((b) => b.textContent);

describe('file links in the Visual view', () => {
  it('a raw block naming files shows no "Open …" row (the link tooltip in its code is enough)', () => {
    const { parent } = setup('#import "template.typ": template\n#include "appendix.typ"\n\nHello\n');
    expect(parent.querySelector('.typst-visual__raw-block')).not.toBeNull();
    expect(buttons(parent.querySelector('.typst-visual__raw-block')!)).toEqual([]);
  });

  it("an image box's path in its heading opens the image", () => {
    const { parent, links } = setup('#image("logo.png")\n\nHello\n');
    const label = parent.querySelector('.typst-visual__image-label')!;
    expect(label.textContent).toBe('Image: logo.png');
    label.querySelector<HTMLButtonElement>('button.typst-visual__path')!.click();
    expect(links.open).toHaveBeenCalledWith(path('/logo.png'));
  });

  it("a missing image's path is marked, not a link", () => {
    const { parent } = setup('#image("gone.png")\n\nHello\n');
    const label = parent.querySelector('.typst-visual__image-label')!;
    expect(label.querySelector('button')).toBeNull();
    expect(label.querySelector('.typst-visual__path--missing')!.getAttribute('title')).toBe('gone.png is not in the project');
  });
});
