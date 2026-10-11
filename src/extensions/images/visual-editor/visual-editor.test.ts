// @vitest-environment jsdom
// Tests for visual-editor.ts: an image box's path as the document link on it.
import { describe, expect, it, vi } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { findFilePaths } from '../../../core/typst-syntax/typst-syntax';
import { SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';
import type { DocumentLink, TextDocument } from '../../../hosts/languages/languages';
import { createVisualEditor } from '../../../testing/testing';

const path = ProjectPath.of;

/** An image box of `text`, whose path links to /logo.png when the call names it, else to a missing file. */
function setup(text: string) {
  const links = {
    provideDocumentLinks: ({ text: src }: TextDocument): DocumentLink[] => [
      src.includes('logo.png') ? { range: SourceRange.of({ from: 8, to: 16 }), target: path('/logo.png') } : { range: SourceRange.of({ from: 8, to: 16 }), tooltip: 'gone.png is not in the project' },
    ],
    open: vi.fn(),
  };
  const parent = document.body.appendChild(document.createElement('div'));
  createVisualEditor(parent, new TypstDocument(text), { links });
  return { parent, links };
}

describe("an image box's path", () => {
  it('opens the target of its link', () => {
    const { parent, links } = setup('#image("logo.png")\n\nHello\n');
    const label = parent.querySelector('.typst-images__label')!;
    expect(label.textContent).toBe('Image: logo.png');
    const button = label.querySelector<HTMLButtonElement>('button.typst-images__path')!;
    expect(button.title).toBe('Open logo.png');
    button.click();
    expect(links.open).toHaveBeenCalledWith(path('/logo.png'));
  });

  it('is marked, with the tooltip of its link, when the link has no target', () => {
    const { parent } = setup('#image("gone.png")\n\nHello\n');
    const label = parent.querySelector('.typst-images__label')!;
    expect(label.querySelector('button')).toBeNull();
    expect(label.querySelector('.typst-images__path--missing')!.getAttribute('title')).toBe('gone.png is not in the project');
  });

  it("links in a figure too, whose body is written in code (`image(..)`, no `#`)", () => {
    // the paths as the document-links extension finds them: in Typst markup
    const links = {
      provideDocumentLinks: ({ languageId, text }: TextDocument): DocumentLink[] =>
        languageId !== 'typst' ? [] : findFilePaths(text).map(({ from, to }) => ({ range: { from, to }, target: path('/logo.png') })),
      open: vi.fn(),
    };
    const parent = document.body.appendChild(document.createElement('div'));
    createVisualEditor(parent, new TypstDocument('#figure(image("logo.png"), caption: [Logo])\n'), { links });
    parent.querySelector<HTMLButtonElement>('.typst-images__label button.typst-images__path')!.click();
    expect(links.open).toHaveBeenCalledWith(path('/logo.png'));
  });
});
