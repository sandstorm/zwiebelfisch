// @vitest-environment jsdom
// Tests for HEADING_STYLES (visual-editor.ts): the heading levels in the text style menu, through the Visual editor.
import { describe, expect, it } from 'vitest';
import { SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';
import { createVisualEditor } from '../../../testing/testing';

// jsdom lacks layout; ProseMirror only needs these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

describe('headings in the text style menu', () => {
  it('lists Heading 1–3 after Normal text', () => {
    const parent = document.body.appendChild(document.createElement('div'));
    createVisualEditor(parent, new TypstDocument('Text\n'));
    const menu = parent.querySelector<HTMLSelectElement>('select[aria-label="Text style"]')!;
    expect([...menu.options].map((o) => [o.value, o.text])).toEqual([
      ['paragraph', 'Normal text'],
      ['headings.toggleHeading1', 'Heading 1'],
      ['headings.toggleHeading2', 'Heading 2'],
      ['headings.toggleHeading3', 'Heading 3'],
    ]);
  });

  it('sets headings and back to normal text', () => {
    const parent = document.body.appendChild(document.createElement('div'));
    const doc = new TypstDocument('Hello world\n');
    const view = createVisualEditor(parent, doc);
    const menu = parent.querySelector<HTMLSelectElement>('select[aria-label="Text style"]')!;
    const choose = (value: string) => {
      menu.value = value;
      menu.dispatchEvent(new Event('change', { bubbles: true }));
    };
    view.reveal(SourceRange.of({ from: 0, to: 'Hello world'.length }));
    expect(menu.value).toBe('paragraph');
    choose('headings.toggleHeading2');
    expect(doc.text).toBe('== Hello world\n');
    expect(menu.value).toBe('headings.toggleHeading2');
    choose('headings.toggleHeading1');
    expect(doc.text).toBe('= Hello world\n');
    choose('headings.toggleHeading3');
    expect(doc.text).toBe('=== Hello world\n');
    choose('paragraph');
    expect(doc.text).toBe('Hello world\n');
  });
});
