// @vitest-environment jsdom
// Tests for add-label.ts, through the toolbar's Insert ▾ → "Add label".
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { VisualView } from '../visual-view';

// jsdom lacks layout; ProseMirror only needs these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = new VisualView(parent, doc);
  const item = parent.querySelector<HTMLButtonElement>('button[aria-label="Add label"]')!;
  const popover = parent.querySelector<HTMLFormElement>('form[aria-label="New label"]')!;
  const add = (name: string) => {
    item.click();
    const input = popover.querySelector('input')!;
    const prefilled = input.value;
    input.value = name;
    popover.requestSubmit();
    return prefilled;
  };
  return { doc, view, item, add };
}

const TABLE_FIGURE = '#figure(table(columns: 1, [a]), caption: [Timings])\n\nText\n';

describe('Add label', () => {
  it('labels the figure the cursor is in (its caption), suggesting tab: for a table figure', () => {
    const { doc, view, add } = setup(TABLE_FIGURE);
    const at = doc.text.indexOf('Timings');
    view.reveal(at, at);
    expect(add('tab:timings')).toBe('tab:');
    expect(doc.text).toBe('#figure(table(columns: 1, [a]), caption: [Timings]) <tab:timings>\n\nText\n');
  });

  it('labels a heading (sec:) or a paragraph; off where the block has a label already', () => {
    const { doc, view, item, add } = setup('= Intro\n\nText\n');
    view.reveal(2, 2);
    expect(add('sec:intro')).toBe('sec:');
    expect(doc.text).toBe('= Intro <sec:intro>\n\nText\n');
    view.reveal(3, 3);
    expect(item.disabled).toBe(true);
    const text = doc.text.indexOf('Text');
    view.reveal(text, text);
    expect(item.disabled).toBe(false);
    expect(add('plain')).toBe('');
    expect(doc.text).toBe('= Intro <sec:intro>\n\nText <plain>\n');
  });

  it('makes the name a valid label', () => {
    const { doc, view, add } = setup('Text\n');
    view.reveal(1, 1);
    add('my label!');
    expect(doc.text).toBe('Text <my-label>\n');
  });
});
