// @vitest-environment jsdom
// Tests for label-tags.ts's new labels (the block they go on, the name they start from, the draft tag), through the
// toolbar's Insert ▾ → "Add label" and the selection bar's.
import { describe, expect, it } from 'vitest';
import { SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';
import { createVisualEditor, TestPrompts } from '../../../testing/testing';
import { Project } from '../../../core/project/project';
import { ProjectPath } from '../../../core/paths/paths';
import { LabelIndex } from '../model/label-index';
import { references } from './visual-editor';

// jsdom lacks layout; ProseMirror only needs these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const project = new Project(ProjectPath.of('/main.typ'), { '/main.typ': text });
  const view = createVisualEditor(parent, doc, { contributions: [references({ labels: new LabelIndex(project), prompts: new TestPrompts() })] });
  const item = parent.querySelector<HTMLButtonElement>('[aria-label="Formatting"] button[aria-label="Add label"]')!;
  const barItem = parent.querySelector<HTMLButtonElement>('[aria-label="Selection"] button[aria-label="Add label"]')!;
  const draft = () => parent.querySelector<HTMLInputElement>('.ProseMirror input[aria-label="New label"]');
  const key = (input: HTMLInputElement, name: string) => input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
  /** Starts a new label, types `name` into the draft tag and presses Enter; returns what the field started with. */
  const add = (name: string) => {
    item.click();
    const input = draft()!;
    const prefilled = input.value;
    input.value = name;
    key(input, 'Enter');
    return prefilled;
  };
  return { parent, doc, view, item, barItem, draft, key, add };
}

const TABLE_FIGURE = '#figure(table(columns: 1, [a]), caption: [Timings])\n\nText\n';

describe('Add label', () => {
  it('labels the figure the cursor is in (its caption), suggesting tab: for a table figure', () => {
    const { doc, view, add } = setup(TABLE_FIGURE);
    const at = doc.text.indexOf('Timings');
    view.reveal(SourceRange.of({ from: at, to: at }));
    expect(add('tab:timings')).toBe('tab:');
    expect(doc.text).toBe('#figure(table(columns: 1, [a]), caption: [Timings]) <tab:timings>\n\nText\n');
  });

  it('labels a heading (sec:) or a paragraph; off where the block has a label already', () => {
    const { doc, view, item, add } = setup('= Intro\n\nText\n');
    view.reveal(SourceRange.of({ from: 2, to: 2 }));
    expect(add('sec:intro')).toBe('sec:');
    expect(doc.text).toBe('= Intro <sec:intro>\n\nText\n');
    view.reveal(SourceRange.of({ from: 3, to: 3 }));
    expect(item.disabled).toBe(true);
    const text = doc.text.indexOf('Text');
    view.reveal(SourceRange.of({ from: text, to: text }));
    expect(item.disabled).toBe(false);
    expect(add('plain')).toBe('');
    expect(doc.text).toBe('= Intro <sec:intro>\n\nText <plain>\n');
  });

  it('makes the name a valid label', () => {
    const { doc, view, add } = setup('Text\n');
    view.reveal(SourceRange.of({ from: 1, to: 1 }));
    add('my label!');
    expect(doc.text).toBe('Text <my-label>\n');
  });

  it('the draft tag shows where the label will go; Escape drops it without a change', () => {
    const { parent, doc, view, item, draft, key } = setup(TABLE_FIGURE);
    const at = doc.text.indexOf('Timings');
    view.reveal(SourceRange.of({ from: at, to: at }));
    item.click();
    const input = draft()!;
    // below the figure, where its tag will be
    expect(input.closest('.typst-labels__tag--block')).not.toBeNull();
    expect(parent.querySelector('figure')!.nextElementSibling).toBe(input.closest('.typst-labels__tag'));
    key(input, 'Escape');
    expect(draft()).toBeNull();
    expect(doc.text).toBe(TABLE_FIGURE);
  });

  it('the selection bar has it where the selection\'s block can take a new label, and nothing where it has one', () => {
    const { doc, view, barItem, draft, key } = setup('= Intro\n\n= Method <sec:method>\n');
    view.reveal(SourceRange.of({ from: 2, to: 5 }));
    expect(barItem.hidden).toBe(false);
    barItem.click();
    const input = draft()!;
    expect(input.value).toBe('sec:');
    input.value = 'sec:intro';
    key(input, 'Enter');
    expect(doc.text).toBe('= Intro <sec:intro>\n\n= Method <sec:method>\n');
    view.reveal(SourceRange.of({ from: 2, to: 5 }));
    expect(barItem.hidden).toBe(true);
    const method = doc.text.indexOf('Method');
    view.reveal(SourceRange.of({ from: method, to: method + 3 }));
    expect(barItem.hidden).toBe(true);
  });
});
