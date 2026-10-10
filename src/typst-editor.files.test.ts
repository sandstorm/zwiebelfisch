// @vitest-environment jsdom
// Tests for typst-editor.ts: the file panel and file links in the composed widget (preview mocked: no worker in jsdom).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { createTypstEditor, type TypstEditorOptions } from './typst-editor';

vi.mock('./features/preview/preview', () => ({
  Preview: class {
    update() {}
    reveal() {}
    showPresence() {}
    snippet = async () => null;
    onRender = () => () => {};
    destroy() {}
  },
}));

function setup(options: TypstEditorOptions) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createTypstEditor(host, { mode: 'source', ...options });
  const items = () => [...host.querySelectorAll<HTMLElement>('[role=treeitem]')];
  const item = (title: string) => items().find((t) => t.title === title);
  const source = () => {
    const visible = [...host.querySelectorAll<HTMLElement>('.typst-editor__pane')].find((pane) => !pane.hidden && pane.querySelector('.cm-editor'));
    return EditorView.findFromDOM(visible!.querySelector<HTMLElement>('.cm-editor')!)!;
  };
  const filesOpen = () => !host.querySelector<HTMLElement>('[data-testid=typst-files]')!.closest<HTMLElement>('.typst-editor__panel')!.hidden;
  return { host, editor, items, item, source, filesOpen };
}

afterEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
});

describe('the file panel in the widget', () => {
  it('is collapsed to its rail button for a single file and open with more files (auto)', () => {
    const single = setup({ source: '= Hello' });
    expect(single.filesOpen()).toBe(false);
    expect(single.host.querySelector('[data-testid=typst-panel-toggle-files]')).not.toBeNull();
    const several = setup({ source: '= Hello', files: { '/chapters/intro.typ': 'Intro' } });
    expect(several.filesOpen()).toBe(true);
    expect(several.items().map((t) => t.title)).toEqual(['chapters', 'main.typ']);
  });

  it('`hide` shows no panel and no rail button; `show` opens it for one file', () => {
    const hidden = setup({ source: '= Hello', files: { '/a.typ': 'A' }, fileList: 'hide' });
    expect(hidden.host.querySelector<HTMLElement>('.typst-editor__side')!.hidden).toBe(true);
    expect(setup({ source: '= Hello', fileList: 'show' }).filesOpen()).toBe(true);
  });

  it('expanding a folder and clicking a file opens it', () => {
    const { editor, item } = setup({ source: '= Hello', files: { '/chapters/intro.typ': 'Intro' } });
    item('chapters')!.click();
    item('chapters/intro.typ')!.click();
    expect(editor.activeFile).toBe('/chapters/intro.typ');
    expect(item('chapters/intro.typ')!.getAttribute('aria-selected')).toBe('true');
  });
});

describe('file links in the widget', () => {
  const files = { '/template.typ': '#let template(doc) = doc', '/chapters/intro.typ': '#image("../logo.png")' };

  it('Mod+click on an #import path in the Source view opens the file and the panel shows it', () => {
    const { editor, source, item } = setup({ source: '#import "template.typ": template\n= Hello', files });
    const view = source();
    view.posAtCoords = () => 10;
    view.contentDOM.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }));
    expect(editor.activeFile).toBe('/template.typ');
    expect(item('template.typ')!.getAttribute('aria-selected')).toBe('true');
  });

  it('paths resolve from the folder of the file they are written in', () => {
    const { editor, source, item } = setup({ source: '#include "chapters/intro.typ"', files });
    source().posAtCoords = () => 12;
    source().contentDOM.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }));
    expect(editor.activeFile).toBe('/chapters/intro.typ');
    expect(item('chapters')!.getAttribute('aria-expanded')).toBe('true');
  });
});
