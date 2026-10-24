// @vitest-environment jsdom
// Tests for editor.ts: the changes extension in the composed widget (preview mocked: no worker in jsdom). The changes
// of a commit, or between two, show the files as they were at the later one, read-only, in the Visual and the Source
// editor, with the changes marked; ending the comparison goes back to the project's file.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EventEmitter } from '../core/event-emitter/event-emitter';
import { ProjectPath } from '../core/paths/paths';
import type { Extension } from '../hosts/extension-host/extension-host';
import type { SourceControlHistoryItem } from '../hosts/scm/scm';
import { SOURCE_EDITOR } from '../hosts/source-editor/source-editor';
import { VISUAL_EDITOR } from '../hosts/visual-editor/visual-editor';
import { createEditor } from './editor';

vi.mock('../hosts/preview/preview', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Preview: class {
    onDidLoad = () => ({ dispose() {} });
    onDidCrash = () => ({ dispose() {} });
    isEmpty = true;
    registerPaneOverlay = () => ({ dispose() {} });
    update() {}
    reveal() {}
    snippet = async () => null;
    onDidRender = () => ({ dispose() {} });
    onDidClickPage = () => ({ dispose() {} });
    createPageOverlay = () => ({ set() {}, dispose() {} });
    boxesFor = async () => [];
    onDidChangeDiagnostics = () => ({ dispose() {} });
    zoom = 'fit';
    setZoom() {}
    scale = 1;
    visiblePage = { index: 0, count: 0 };
    onDidChangeView = () => ({ dispose() {} });
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

// jsdom lacks layout; ProseMirror and CodeMirror only need these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
Element.prototype.scrollIntoView = () => {};

afterEach(() => document.body.replaceChildren());

const FIRST: SourceControlHistoryItem = { id: 'c0ffee1', parentIds: [], subject: 'First', message: 'First', displayId: 'c0ffee1', timestamp: Date.now() };
const SECOND: SourceControlHistoryItem = { id: 'b0a7b0a', parentIds: ['c0ffee1'], subject: 'Second', message: 'Second', displayId: 'b0a7b0a', timestamp: Date.now() };
const THIRD: SourceControlHistoryItem = { id: 'd00d1e3', parentIds: ['b0a7b0a'], subject: 'Third', message: 'Third', displayId: 'd00d1e3', timestamp: Date.now() };

/** The files at each commit: /b.typ goes in the second, /main.typ changes in each. */
const AT: Record<string, Record<string, string>> = {
  c0ffee1: { '/main.typ': 'The slow fox.\n', '/b.typ': 'Bee\n' },
  b0a7b0a: { '/main.typ': 'The brown fox.\n' },
  d00d1e3: { '/main.typ': 'The quick brown fox.\n' },
};

function setup() {
  const repository: Extension = {
    id: 'repository',
    activate: ({ scm, subscriptions }) =>
      subscriptions.push(
        scm.registerSourceControl({
          id: 'git',
          label: 'Git',
          busy: false,
          onDidChange: new EventEmitter<void>().event,
          quickDiffProvider: { provideOriginalText: (path) => AT.d00d1e3[path] ?? '' },
          historyProvider: {
            currentHistoryItemRef: { id: THIRD.id, name: 'main' },
            provideHistoryItems: async () => ({ items: [THIRD, SECOND, FIRST] }),
            provideHistoryItemChanges: async (id) =>
              id === SECOND.id
                ? [
                    { path: ProjectPath.of('/b.typ'), kind: 'deleted' },
                    { path: ProjectPath.of('/main.typ'), kind: 'modified' },
                  ]
                : [{ path: ProjectPath.of('/main.typ'), kind: 'modified' }],
            provideFileContent: async (id, path) => (AT[id][path] === undefined ? undefined : new TextEncoder().encode(AT[id][path])),
            onDidChangeCurrentHistoryItem: new EventEmitter<void>().event,
          },
        }),
      ),
  };
  const host = document.createElement('div');
  document.body.append(host);
  const editor = createEditor(host, { viewType: VISUAL_EDITOR, files: { '/main.typ': 'The quick brown fox jumps.\n' }, extensions: (builtins) => [...builtins, repository] });
  const shownPane = () => [...host.querySelectorAll<HTMLElement>('.zwf-editor__pane')].find((pane) => !pane.hidden)!;
  const visual = () => shownPane().querySelector<HTMLElement>('[data-testid="zwf-visual"]');
  const source = () => EditorView.findFromDOM(shownPane().querySelector<HTMLElement>('.cm-editor')!)!;
  const history = () => host.querySelector<HTMLElement>('.zwf-history')!;
  const row = (subject: string) => [...history().querySelectorAll<HTMLButtonElement>('.zwf-history__row')].find((each) => each.querySelector('.zwf-history__subject')?.textContent === subject)!;
  const file = (name: string) => [...history().querySelectorAll<HTMLButtonElement>('.zwf-history__file-row')].find((each) => each.title.startsWith(name))!;
  const editorTitle = () => [...host.querySelectorAll<HTMLButtonElement>('.zwf-editor__tab-action')].map((button) => button.textContent);
  const settle = async () => {
    await vi.advanceTimersByTimeAsync(1000);
  };
  return { host, editor, visual, source, history, row, file, editorTitle, settle };
}

describe('changes in the widget', () => {
  it('shows a commit’s file as it was there, read-only, its changes marked in both editors; ✕ goes back to the project’s file', async () => {
    vi.useFakeTimers();
    try {
      const { editor, visual, source, row, file, editorTitle, settle, history } = setup();
      await editor.executeCommand('workbench.view.history');
      await settle();
      // the click on the commit opens the file shown as it was there, as the commit changed it
      row('Second').click();
      await settle();
      expect(editor.activeFile).toBe('/@b0a7b0a/main.typ');
      expect(visual()!.textContent).toBe('The slowbrown fox.');
      expect(visual()!.getAttribute('contenteditable')).toBe('false');
      expect(visual()!.querySelector('.zwf-changes__inserted')?.textContent?.trim()).toBe('brown');
      expect(visual()!.querySelector('del.zwf-changes__deleted')?.textContent).toBe('slow');
      expect(editorTitle()).toContain('b0a7b0a · read-only · changes since c0ffee1');

      // the Source editor of the same file: read-only, the same changes
      const tab = [...document.querySelectorAll<HTMLButtonElement>('.zwf-editor__tab')].find((each) => each.dataset.viewType === SOURCE_EDITOR)!;
      tab.click();
      await settle();
      const view = source();
      expect(view.state.doc.toString()).toBe('The brown fox.\n');
      expect(view.state.readOnly).toBe(true);
      expect(view.dom.querySelector('.cm-deletedChunk')?.textContent).toContain('The slow fox.');
      view.dispatch({ changes: { from: 0, insert: 'X' } });
      expect(view.state.doc.toString()).toBe('The brown fox.\n');
      expect(editor.files['/main.typ']).toBe('The quick brown fox jumps.\n');

      // a file the commit deleted: its earlier text, all deleted
      file('b.typ').click();
      await settle();
      expect(editor.activeFile).toBe('/@b0a7b0a/b.typ');
      expect(source().state.doc.toString()).toBe('');
      expect(source().dom.querySelector('.cm-deletedChunk')?.textContent).toContain('Bee');

      history().querySelector<HTMLButtonElement>('button[aria-label="Stop showing changes"]')!.click();
      await settle();
      expect(editor.activeFile).toBe('/main.typ');
      expect(Object.keys(editor.files)).toEqual(['/main.typ']);
      expect(editorTitle().some((title) => title?.includes('read-only'))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('follows a file shown as it was when the comparison changes: the later commit of a range, then the project’s file', async () => {
    vi.useFakeTimers();
    try {
      const { editor, row, editorTitle, settle, host } = setup();
      await editor.executeCommand('workbench.view.history');
      await settle();
      row('Second').click();
      await settle();
      expect(editor.activeFile).toBe('/@b0a7b0a/main.typ');
      // the click on it again: off, back to the project's file
      row('Second').click();
      await settle();
      expect(editor.activeFile).toBe('/main.typ');
      row('Second').click();
      await settle();

      row('Third').dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
      await settle();
      expect(editor.activeFile).toBe('/@d00d1e3/main.typ');
      expect(editorTitle()).toContain('d00d1e3 · read-only · changes since b0a7b0a');

      // the right click's menu: "Compare with current state"
      row('First').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
      const entry = [...host.querySelectorAll<HTMLElement>('[role=menuitem]')].find((each) => each.textContent?.includes('Compare with current state'))!;
      entry.click();
      await settle();
      expect(editor.activeFile).toBe('/main.typ');
      expect(host.querySelector('[data-testid="zwf-history-mode"]')!.textContent).toBe('Changes since c0ffee1 (to now)✕');
    } finally {
      vi.useRealTimers();
    }
  });
});
