// @vitest-environment jsdom
// Tests for image-path-link.ts: an image box's path as the document link on it.
import { describe, expect, it, vi } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import type { DocumentLink, TextDocument } from '../../../hosts/languages/languages';
import { createVisualView } from '../../../testing/testing';

const path = ProjectPath.of;

/** An image box of `text`, whose path links to /logo.png when the call names it, else to a missing file. */
function setup(text: string) {
  const links = {
    provideDocumentLinks: ({ text: src }: TextDocument): DocumentLink[] => [
      src.includes('logo.png') ? { range: { from: 8, to: 16 }, target: path('/logo.png') } : { range: { from: 8, to: 16 }, tooltip: 'gone.png is not in the project' },
    ],
    open: vi.fn(),
  };
  const parent = document.body.appendChild(document.createElement('div'));
  createVisualView(parent, new TypstDocument(text), { links });
  return { parent, links };
}

describe("an image box's path", () => {
  it('opens the target of its link', () => {
    const { parent, links } = setup('#image("logo.png")\n\nHello\n');
    const label = parent.querySelector('.typst-visual__image-label')!;
    expect(label.textContent).toBe('Image: logo.png');
    const button = label.querySelector<HTMLButtonElement>('button.typst-visual__path')!;
    expect(button.title).toBe('Open logo.png');
    button.click();
    expect(links.open).toHaveBeenCalledWith(path('/logo.png'));
  });

  it('is marked, with the tooltip of its link, when the link has no target', () => {
    const { parent } = setup('#image("gone.png")\n\nHello\n');
    const label = parent.querySelector('.typst-visual__image-label')!;
    expect(label.querySelector('button')).toBeNull();
    expect(label.querySelector('.typst-visual__path--missing')!.getAttribute('title')).toBe('gone.png is not in the project');
  });
});
