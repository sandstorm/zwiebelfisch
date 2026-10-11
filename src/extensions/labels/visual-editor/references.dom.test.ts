// @vitest-environment jsdom
// Tests for visual-editor.ts in a VisualEditor (jsdom): chips with hints, label tags, the @ list, renaming with references.
import { readFileSync } from 'node:fs';
import type { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { Project } from '../../../core/project/project';
import { LabelIndex } from '../model/label-index';
import { createVisualEditor, TestPrompts } from '../../../testing/testing';
import { VisualEditor, VisualEditorHost } from '../../../hosts/visual-editor/visual-editor';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { ProjectPath } from '../../../core/paths/paths';
import type { InputBoxOptions } from '../../../hosts/window/window';
import { references } from './visual-editor';

const path = ProjectPath.of;

// jsdom's import.meta.url is not a file URL: read relative to the repository root
const ADVANCED = 'demo/examples/advanced/';
const CHAPTERS = ['introduction', 'method', 'results'];

/** The advanced example's chapters, its label index, and a Visual editor of the introduction (or `path`). */
function setup(file = path('/chapters/introduction.typ'), edit?: (files: Record<string, string>) => void, prompts = new TestPrompts()) {
  const files = Object.fromEntries(CHAPTERS.map((c) => [`/chapters/${c}.typ`, readFileSync(`${ADVANCED}chapters/${c}.typ`, 'utf8')]));
  edit?.(files);
  const project = new Project(path('/main.typ'), { '/main.typ': '#include "chapters/introduction.typ"\n', ...files });
  const labels = new LabelIndex(project);
  const parent = document.createElement('div');
  document.body.append(parent);
  const document_ = project.document(file)!;
  createVisualEditor(parent, document_, { contributions: [references({ labels, prompts })] });
  const editor = (parent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
  const text = (p: string) => project.document(path(p))!.text;
  return { project, labels, parent, editor, document: document_, text };
}

/** Types `text` at the selection as the browser would (text input handlers run). */
function type(editor: Editor, text: string): void {
  const { view } = editor;
  for (const char of text) {
    const { from, to } = view.state.selection;
    const insert = () => view.state.tr.insertText(char, from, to);
    if (!view.someProp('handleTextInput', (f) => f(view, from, to, char, insert))) view.dispatch(insert());
  }
}

function press(editor: Editor, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  return editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)) ?? false;
}

/** Puts the cursor at the end of the paragraph containing `text`. */
function cursorAfter(editor: Editor, text: string): void {
  let end = -1;
  editor.state.doc.descendants((node, pos) => {
    if (end < 0 && node.isTextblock && node.textContent.includes(text)) end = pos + node.nodeSize - 1;
  });
  editor.commands.setTextSelection(end);
}

const chip = (parent: HTMLElement, target: string) => parent.querySelector<HTMLElement>(`.typst-labels__ref[data-target="${target}"]`)!;
const tick = () => new Promise((resolve) => setTimeout(resolve));

describe('references in the Visual editor', () => {
  it('shows references as chips with what they point to', () => {
    const { parent } = setup();
    expect(chip(parent, 'method').textContent).toBe('method');
    expect(chip(parent, 'method').dataset.hint).toBe('Section · Method');
    expect(chip(parent, 'fig:compile-times').dataset.hint).toBe('Figure · Cold (dark) and incremental (light)…');
    expect(chip(parent, 'results').hasAttribute('title')).toBe(false); // the hover is its document link's
    expect(parent.querySelector('.typst-labels__ref--unknown')).toBeNull();
  });

  it('marks references to missing labels, and unmarks them once the label exists', async () => {
    const { parent, project } = setup(path('/chapters/introduction.typ'), (files) => {
      files['/chapters/method.typ'] = files['/chapters/method.typ'].replace('<method>', '<approach>');
    });
    expect(chip(parent, 'method').classList.contains('typst-labels__ref--unknown')).toBe(true);
    expect(chip(parent, 'method').title).toContain('no label <method>');
    const method = project.document(path('/chapters/method.typ'))!;
    method.setText(method.text.replace('<approach>', '<method>'), 'test');
    await tick();
    expect(chip(parent, 'method').classList.contains('typst-labels__ref--unknown')).toBe(false);
  });

  it('shows the heading label as a tag in the heading, not as a raw box', () => {
    const { parent } = setup();
    const tag = parent.querySelector<HTMLElement>('h1 [data-testid="typst-label-tag"]');
    expect(tag?.textContent).toBe('intro');
    expect(parent.querySelector('h1')?.textContent).toBe('Introductionintro');
    expect([...parent.querySelectorAll('.typst-visual__raw-block')].some((b) => b.textContent?.includes('<intro>'))).toBe(false);
  });

  it('typing @ lists the project\'s labels; Enter inserts the chosen one as a reference', () => {
    const { parent, editor, text } = setup();
    cursorAfter(editor, 'sums them up');
    type(editor, ' See @');
    const list = parent.querySelector<HTMLElement>('[data-testid="typst-suggest"]')!;
    expect(list.hidden).toBe(false);
    const options = () => [...list.querySelectorAll('[role="option"]')].map((o) => o.querySelector('.typst-visual__suggest-label')!.textContent);
    expect(options()).toEqual(['intro', 'method', 'eq:speedup', 'fig:measurement', 'results', 'tab:timings', 'fig:compile-times', 'tab:runs']);
    type(editor, 'fig');
    expect(options()).toEqual(['fig:measurement', 'fig:compile-times']);
    type(editor, ':c');
    expect(options()).toEqual(['fig:compile-times']);
    expect(press(editor, 'Enter')).toBe(true);
    expect(text(path('/chapters/introduction.typ'))).toContain('one picture. See @fig:compile-times\n');
    expect(list.hidden).toBe(true);
  });

  it('arrow keys choose, Escape closes the list and keeps the text', () => {
    const { parent, editor, text } = setup();
    cursorAfter(editor, 'sums them up');
    type(editor, ' @');
    press(editor, 'ArrowDown');
    const list = parent.querySelector<HTMLElement>('[data-testid="typst-suggest"]')!;
    expect(list.querySelector('[aria-selected="true"]')?.textContent).toContain('method');
    expect(press(editor, 'Escape')).toBe(true);
    expect(list.hidden).toBe(true);
    type(editor, 'm'); // still dismissed while the same @ is typed on
    expect(list.hidden).toBe(true);
    expect(text(path('/chapters/introduction.typ'))).toContain('one picture. \\@m\n');
  });

  it('a click on a listed label inserts it', () => {
    const { parent, editor, text } = setup();
    cursorAfter(editor, 'sums them up');
    type(editor, ' @res');
    const option = parent.querySelector<HTMLElement>('[role="option"][data-index="0"]')!;
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    expect(text(path('/chapters/introduction.typ'))).toContain('one picture. @results\n');
  });

  it('typing a whole label name and a space or full stop makes it a reference', () => {
    const { editor, text } = setup();
    cursorAfter(editor, 'sums them up');
    type(editor, ' @intro. And @nolabel ');
    expect(text(path('/chapters/introduction.typ'))).toContain('one picture. @intro. And \\@nolabel \n');
  });

  const tagNamed = (parent: HTMLElement, name: string) =>
    [...parent.querySelectorAll<HTMLElement>('[data-testid="typst-label-tag"]')].find((t) => t.textContent === name)!;

  it('renaming a label from its tag updates every reference in the project (the first choice)', async () => {
    const prompts = new TestPrompts().answer('Rename…', 'fig:times');
    const { parent, text } = setup(path('/chapters/results.typ'), undefined, prompts);
    tagNamed(parent, 'fig:compile-times').click();
    await tick();
    const [pick, input] = prompts.asked;
    expect(pick.items).toMatchObject([
      { label: 'Rename…', description: 'and update 2 references' },
      { label: 'Rename without updating references…' },
      { label: 'Remove label' },
    ]);
    expect(input.options).toMatchObject({ title: 'Rename <fig:compile-times> and update 2 references', prompt: 'Label name', value: 'fig:compile-times' });
    expect(text(path('/chapters/results.typ'))).toContain('@fig:times shows the same data');
    expect(text(path('/chapters/results.typ'))).toContain(') <fig:times>');
    expect(text(path('/chapters/introduction.typ'))).toContain('@fig:times sums them up');
  });

  it('"Rename without updating references" renames only the label', async () => {
    const prompts = new TestPrompts().answer('Rename without updating references…', 'fig:times');
    const { parent, text } = setup(path('/chapters/results.typ'), undefined, prompts);
    tagNamed(parent, 'fig:compile-times').click();
    await tick();
    expect(text(path('/chapters/results.typ'))).toContain(') <fig:times>');
    expect(text(path('/chapters/results.typ'))).toContain('@fig:compile-times shows the same data');
  });

  it('without references, Rename renames the label, and Remove removes it', async () => {
    const prompts = new TestPrompts().answer('Rename…', 'start here', 'Remove label');
    const { parent, text } = setup(undefined, undefined, prompts);
    const tagOf = () => parent.querySelector<HTMLElement>('h1 [data-testid="typst-label-tag"]');
    tagOf()!.click();
    await tick();
    expect(prompts.asked[0].items).toMatchObject([{ label: 'Rename…', description: undefined }, { label: 'Remove label' }]); // nothing refers to <intro>
    expect((prompts.asked[1].options as InputBoxOptions).validateInput?.('  ')).toBe('Enter a label name.');
    expect(text(path('/chapters/introduction.typ'))).toContain('= Introduction <start-here>\n');
    tagOf()!.click();
    await tick();
    expect(text(path('/chapters/introduction.typ'))).toContain('= Introduction\n');
    expect(tagOf()).toBeNull();
  });

  it('a cancelled choice changes nothing', async () => {
    const { parent, text } = setup(undefined, undefined, new TestPrompts());
    const before = text(path('/chapters/introduction.typ'));
    parent.querySelector<HTMLElement>('h1 [data-testid="typst-label-tag"]')!.click();
    await tick();
    expect(text(path('/chapters/introduction.typ'))).toBe(before);
  });
});

describe('references without the other constructs', () => {
  it('offers the labels after @ also where no extension contributes inline code', () => {
    const project = new Project(path('/main.typ'), { '/main.typ': '= Intro <intro>\n\nText\n' });
    const contributions = VisualEditorHost.from([references({ labels: new LabelIndex(project), prompts: new TestPrompts() })]);
    const parent = document.body.appendChild(document.createElement('div'));
    new VisualEditor(parent, new TypstDocument('Text\n'), contributions);
    const editor = (parent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
    cursorAfter(editor, 'Text');
    type(editor, ' @');
    expect(parent.querySelector<HTMLElement>('[data-testid="typst-suggest"]')!.hidden).toBe(false);
  });
});
