// @vitest-environment jsdom
// Tests for open-file-hash.ts, in the widget (Source editor). Preview mocked: no worker in jsdom.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type ExtensionContext, ProjectPath, SOURCE_EDITOR, SourceOffset, type Editor } from '../src';
import { hashForLocation, locationFromHash, openFileHash } from './open-file-hash';

vi.mock('../src/hosts/preview/preview', async (importOriginal) => ({
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
    pdfExportOptions = () => [];
    registerViewOption = () => ({ dispose() {} });
    viewOptions = () => [];
    onDidChangeViewOptions = () => ({ dispose() {} });
    engineMemory = 0;
    onDidChangeEngineMemory = () => ({ dispose() {} });
    setViewOptionValues() {}
    registerRenderer = () => ({ dispose() {} });
    renderers = () => [{ id: 'pages', label: 'Pages' }];
    activeRenderer = 'pages';
    setActiveRenderer() {}
    onDidChangeRenderers = () => ({ dispose() {} });
    dispose() {}
  },
}));

const FILES = { '/main.typ': '= Main\n\nText', '/chapter.typ': 'one\ntwo\nthree\nfour' };

let editor: Editor | undefined;
afterEach(() => {
  editor?.dispose();
  vi.useRealTimers();
  document.body.replaceChildren();
});

/** The widget with the extension, from the URL fragment `hash`; `context` is what an extension sees. */
async function mount(hash: string, files: Record<string, string> = FILES) {
  history.replaceState(null, '', hash || location.pathname);
  let context: ExtensionContext | undefined;
  const probe = { id: 'probe', activate: (c: ExtensionContext) => void (context = c) };
  const host = document.body.appendChild(document.createElement('div'));
  editor = createEditor(host, { files, viewType: SOURCE_EDITOR, extensions: (builtins) => [...builtins, openFileHash(), probe] });
  await Promise.resolve();
  const caret = () => {
    const textEditor = context!.window.activeTextEditor!;
    return textEditor.document.text.slice(0, textEditor.selection.from).split('\n').length;
  };
  return { editor, context: context!, caret };
}

describe('the location in the URL fragment', () => {
  it('maps locations and fragments both ways', () => {
    const chapter = ProjectPath.of('/chapters/intro.typ');
    expect(locationFromHash('#/chapters/intro.typ:12')).toEqual({ path: chapter, line: 12 });
    expect(locationFromHash('#/chapters/intro.typ')).toEqual({ path: chapter, line: null });
    expect(locationFromHash('#/a%20b.typ:3')).toEqual({ path: '/a b.typ', line: 3 });
    expect(locationFromHash('#/a.typ:0')).toEqual({ path: '/a.typ', line: null });
    expect(locationFromHash('')).toBeNull();
    expect(locationFromHash('#intro')).toBeNull();
    expect(locationFromHash('#/%')).toEqual({ path: '/%', line: null });
    expect(hashForLocation({ path: ProjectPath.of('/a b.typ'), line: 3 })).toBe('#/a%20b.typ:3');
    expect(hashForLocation({ path: ProjectPath.of('/logo.png'), line: null })).toBe('#/logo.png');
  });

  it('opens the file of the fragment with the cursor at the start of its line', async () => {
    const { editor, caret, context } = await mount('#/chapter.typ:3');
    expect(editor.activeFile).toBe('/chapter.typ');
    expect(context.window.activeTextEditor!.selection.from).toBe(SourceOffset.of('one\ntwo\n'.length));
    expect(caret()).toBe(3);
    expect(location.hash).toBe('#/chapter.typ:3');
  });

  it('opens the main file and names it in the fragment when the file is not there', async () => {
    const { editor } = await mount('#/gone/away.typ:7');
    expect(editor.activeFile).toBe('/main.typ');
    expect(location.hash).toBe('#/main.typ:1');
  });

  it('opens a file that arrives later (a collaboration room), once it is there', async () => {
    const { editor, caret } = await mount('#/late.typ:2', { '/main.typ': '' });
    editor.files = { '/main.typ': '', '/late.typ': 'a\nb' };
    expect(editor.activeFile).toBe('/late.typ');
    expect(caret()).toBe(2);
  });

  it('forgets a missing file once the user went to another one', async () => {
    const { editor } = await mount('#/later.typ');
    editor.open('/chapter.typ');
    expect(location.hash).toBe('#/chapter.typ:1');
    editor.files = { ...FILES, '/later.typ': '' };
    expect(editor.activeFile).toBe('/chapter.typ');
  });

  it('follows the shown file at once and the cursor after a pause, without history entries', async () => {
    const { editor, context } = await mount('');
    vi.useFakeTimers();
    const entries = history.length;
    editor.open('/chapter.typ');
    expect(location.hash).toBe('#/chapter.typ:1');
    context.window.activeTextEditor!.revealRange({ from: SourceOffset.of(9), to: SourceOffset.of(9) });
    expect(location.hash).toBe('#/chapter.typ:1');
    vi.advanceTimersByTime(300);
    expect(location.hash).toBe('#/chapter.typ:3');
    expect(history.length).toBe(entries);
  });

  it('follows edits of the fragment', async () => {
    const { editor, caret } = await mount('#/main.typ');
    history.replaceState(null, '', '#/chapter.typ:4');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(editor.activeFile).toBe('/chapter.typ');
    expect(caret()).toBe(4);
  });
});
