// @vitest-environment jsdom
// Tests for typst-editor.ts: "Changes since …" through the real widget (the preview's worker is stubbed).
import { afterEach, describe, expect, it, vi } from 'vitest';

const previewChanges = vi.hoisted(() => [] as { path: string; ranges: { from: number; to: number }[] | null }[]);

vi.mock('./features/preview/preview', () => ({
  Preview: class {
    constructor(container: HTMLElement) {
      container.append(container.ownerDocument.createElement('div'));
    }
    update() {}
    reveal() {}
    setFollow() {}
    showChanges(path: string, ranges: { from: number; to: number }[] | null) {
      previewChanges.push({ path, ranges });
    }
    snippet() {
      return Promise.resolve(null);
    }
    onRender() {
      return () => {};
    }
    destroy() {}
  },
}));

const { createTypstEditor } = await import('./typst-editor');

function mount(options: Parameters<typeof createTypstEditor>[1]) {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createTypstEditor(host, options);
  const toggle = () => host.querySelector<HTMLButtonElement>('.typst-editor__changes')!;
  const tab = (mode: 'visual' | 'source') => host.querySelector<HTMLButtonElement>(`.typst-editor__tab[data-mode="${mode}"]`)!;
  const visible = (selector: string) =>
    [...host.querySelectorAll<HTMLElement>(selector)].filter((element) => !element.closest('.typst-editor__pane[hidden]'));
  return { host, editor, toggle, tab, visible };
}

/** The bars the preview draws: the newest ranges per path. */
function bars(): Record<string, { from: number; to: number }[] | null> {
  return Object.fromEntries(previewChanges.map(({ path, ranges }) => [path, ranges]));
}

afterEach(() => {
  document.body.replaceChildren();
  previewChanges.length = 0;
});

describe('createTypstEditor: Changes since …', () => {
  it('marks an edit of the main file in the Visual view, the Source view and the preview', () => {
    const { editor, toggle, tab, visible } = mount({ source: 'Hello world\n' });
    expect(toggle().textContent).toBe('Changes since opened');
    editor.source = 'Hello big world\n';
    toggle().click();
    expect(toggle().getAttribute('aria-pressed')).toBe('true');
    expect(visible('.typst-diff-insert').map((element) => element.textContent)).toEqual(['big ']);
    expect(bars()['/main.typ']).toEqual([{ from: 6, to: 10 }]);
    tab('source').click();
    expect(visible('.cm-changedLine').length).toBeGreaterThan(0);
  });

  it('marks edits in every .typ file, each against its own text as opened', () => {
    const { editor, toggle, visible } = mount({ files: { '/main.typ': '#include "chapter.typ"\n', '/chapter.typ': 'Chapter one\n' } });
    editor.open('/chapter.typ');
    editor.files = { ...editor.files, '/chapter.typ': 'Chapter one, new\n' };
    toggle().click();
    expect(visible('.typst-diff-insert').map((element) => element.textContent)).toEqual([', new']);
    expect(bars()['/chapter.typ']).toEqual([{ from: 11, to: 16 }]);
    editor.open('/main.typ');
    expect(visible('.typst-diff-insert')).toEqual([]);
  });

  it('a file not yet shown gets its changes when it is first shown', () => {
    const { editor, toggle, visible } = mount({ files: { '/main.typ': 'Main\n', '/a.typ': 'Alpha\n' } });
    toggle().click();
    editor.files = { ...editor.files, '/a.typ': 'Alpha beta\n' };
    expect(bars()['/a.typ']).toEqual([{ from: 5, to: 10 }]);
    editor.open('/a.typ');
    expect(visible('.typst-diff-insert').map((element) => element.textContent)).toEqual([' beta']);
  });

  it('a file created since opening is all new', () => {
    const { editor, toggle } = mount({ files: { '/main.typ': 'Main\n' } });
    editor.files = { '/new.typ': 'Fresh\n' };
    toggle().click();
    expect(bars()['/new.typ']).toEqual([{ from: 0, to: 6 }]);
  });

  it('switching off clears every file in the preview', () => {
    const { editor, toggle } = mount({ files: { '/main.typ': 'Main\n', '/a.typ': 'Alpha\n' } });
    toggle().click();
    editor.files = { ...editor.files, '/a.typ': 'Alpha beta\n' };
    toggle().click();
    expect(bars()).toEqual({ '/main.typ': null, '/a.typ': null });
  });

  it('setBase applies to the main file by default, to another file with a path; one shared label', () => {
    const { editor, toggle, visible } = mount({ files: { '/main.typ': 'Hello big world\n', '/a.typ': 'Alpha beta\n' } });
    editor.setBase('Hello world\n', 'v1');
    expect(toggle().textContent).toBe('Changes since v1');
    expect(visible('.typst-diff-insert').map((element) => element.textContent)).toEqual(['big ']);
    editor.setBase('Alpha\n', 'v1', '/a.typ');
    editor.open('/a.typ');
    expect(visible('.typst-diff-insert').map((element) => element.textContent)).toEqual([' beta']);
  });
});
