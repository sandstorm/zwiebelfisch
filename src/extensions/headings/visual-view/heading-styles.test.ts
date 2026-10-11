// @vitest-environment jsdom
// Tests for HEADING_STYLES (visual-view.ts): the heading levels in the text style menu, through the Visual view.
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { createVisualView } from '../../../testing/testing';

// jsdom lacks layout; ProseMirror only needs these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

describe('headings in the text style menu', () => {
  it('lists Heading 1–3 after Normal text', () => {
    const parent = document.body.appendChild(document.createElement('div'));
    createVisualView(parent, new TypstDocument('Text\n'));
    const menu = parent.querySelector<HTMLSelectElement>('select[aria-label="Text style"]')!;
    expect([...menu.options].map((o) => [o.value, o.text])).toEqual([
      ['paragraph', 'Normal text'],
      ['heading-1', 'Heading 1'],
      ['heading-2', 'Heading 2'],
      ['heading-3', 'Heading 3'],
    ]);
  });

  it('sets headings and back to normal text', () => {
    const parent = document.body.appendChild(document.createElement('div'));
    const doc = new TypstDocument('Hello world\n');
    const view = createVisualView(parent, doc);
    const menu = parent.querySelector<HTMLSelectElement>('select[aria-label="Text style"]')!;
    const choose = (value: string) => {
      menu.value = value;
      menu.dispatchEvent(new Event('change', { bubbles: true }));
    };
    view.reveal(0, 'Hello world'.length);
    expect(menu.value).toBe('paragraph');
    choose('heading-2');
    expect(doc.text).toBe('== Hello world\n');
    expect(menu.value).toBe('heading-2');
    choose('heading-1');
    expect(doc.text).toBe('= Hello world\n');
    choose('heading-3');
    expect(doc.text).toBe('=== Hello world\n');
    choose('paragraph');
    expect(doc.text).toBe('Hello world\n');
  });
});
