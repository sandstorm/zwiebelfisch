// @vitest-environment jsdom
// Tests for typst-editor.ts: a project's custom block style holding a code block, through the composed widget with the
// built-ins: the docs' `example` (docs/template.typ) in a chapter of the docs (preview mocked: no worker in jsdom).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import template from '../../docs/template.typ?raw';
import { createTypstEditor } from './typst-editor';

vi.mock('../hosts/preview/preview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Preview: class {
    update() {}
    reveal() {}
    snippet = async () => null;
    onDidRender = () => ({ dispose() {} });
    onDidClickPage = () => ({ dispose() {} });
    onDidChangeDiagnostics = () => ({ dispose() {} });
    registerToolbarItem = () => ({ dispose() {} });
    registerPdfExportOption = () => ({ dispose() {} });
    registerViewOption = () => ({ dispose() {} });
    viewOptions = () => [];
    onDidChangeViewOptions = () => ({ dispose() {} });
    engineMemory = 0;
    onDidChangeEngineMemory = () => ({ dispose() {} });
    setViewOptionValues() {}
    pdfExportOptions = () => [];
    dispose() {}
  },
}));

// jsdom lacks layout; ProseMirror only needs these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

/** The docs' chapters showing an example, by path in the docs project. */
const CHAPTERS = Object.fromEntries(
  Object.entries(import.meta.glob<string>('../../docs/20_features/*.typ', { query: '?raw', import: 'default', eager: true }))
    .filter(([, text]) => text.includes('#example['))
    .map(([path, text]) => [path.slice('../../docs'.length), text]),
);

const CHAPTER_PATH ='/20_features/09_table-of-contents.typ';
const CHAPTER = [
  '= Headings <features-headings>',
  '',
  '#import "../template.typ": example',
  '',
  '#example[',
  '  ```typ',
  '  #set heading(numbering: "1.")',
  '  = Introduction',
  '  #outline()',
  '  ```',
  ']',
  '',
  'After.',
  '',
].join('\n');

function setup() {
  const host = document.body.appendChild(document.createElement('div'));
  const files = { '/main.typ': `#include "${CHAPTER_PATH.slice(1)}"\n`, '/template.typ': template, [CHAPTER_PATH]: CHAPTER };
  const editor = createTypstEditor(host, { files });
  editor.open(CHAPTER_PATH);
  const pane = () => [...host.querySelectorAll<HTMLElement>('.typst-editor__pane')].find((p) => !p.hidden)!;
  const tiptap = () => (pane().querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
  return { host, editor, pane, tiptap };
}

afterEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
});

describe("the docs' example block style", () => {
  it('is offered in the text style menu of a docs chapter, declared in template.typ', () => {
    const { pane } = setup();
    const menu = pane().querySelector<HTMLSelectElement>('select[aria-label="Text style"]')!;
    expect([...menu.options].map((o) => [o.value, o.text])).toContainEqual(['block:example', 'Example']);
  });

  it('shows a chapter\'s #example[```typ …```] as the styled block "Example" with the code block in it, unchanged when printed back', () => {
    const { pane, tiptap, editor } = setup();
    const block = pane().querySelector<HTMLElement>('.typst-styles__block')!;
    expect(block.getAttribute('data-style-title')).toBe('Example');
    const code = block.querySelector<HTMLElement>('.typst-markup__code-block');
    expect(code).not.toBeNull();
    expect(code!.querySelector<HTMLInputElement>('input[aria-label="Language"]')!.value).toBe('typ');
    // without the indentation Typst removes
    expect(code!.querySelector('code')!.textContent).toBe('#set heading(numbering: "1.")\n= Introduction\n#outline()');
    expect(block.childElementCount).toBe(1);
    expect(tiptap().state.doc.child(2).child(0).type.name).toBe('codeBlock');
    expect(editor.files[CHAPTER_PATH]).toBe(CHAPTER);
  });

  it("shows the docs' chapters with examples as Example blocks holding a code block, their files unchanged", () => {
    expect(Object.keys(CHAPTERS).length).toBeGreaterThanOrEqual(4);
    for (const [path, text] of Object.entries(CHAPTERS)) {
      const files = { '/main.typ': '', '/template.typ': template, [path]: text };
      const host = document.body.appendChild(document.createElement('div'));
      const editor = createTypstEditor(host, { files });
      editor.open(path);
      const blocks = [...host.querySelectorAll<HTMLElement>('.typst-styles__block')].filter((b) => !b.closest('[hidden]'));
      expect(blocks.map((b) => [b.dataset.styleTitle, b.querySelectorAll('.typst-markup__code-block').length]), path).toEqual([['Example', 1]]);
      expect(editor.files[path]).toBe(text);
    }
  });

  it('editing the code changes only that text', () => {
    const { tiptap, editor } = setup();
    const view = tiptap().view;
    let at = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text!.includes('= Introduction')) at = pos + node.text!.indexOf('Introduction') + 'Introduction'.length;
    });
    view.dispatch(view.state.tr.insertText(' and goals', at));
    expect(editor.files[CHAPTER_PATH]).toBe(CHAPTER.replace('= Introduction', '= Introduction and goals'));
  });
});
