// @vitest-environment jsdom
// Tests for changes.ts: one comparison shown alike by the History panel, the View menu's toggle, the status bar and
// the live Visual and Source editors (marks only while it goes to the current state). Files of a commit shown
// read-only are in editor.changes.test.ts.
import { EditorState, type Extension as CodeExtension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import { TypstDocument } from '../../core/typst-document/typst-document';
import type { Extension, ExtensionContext, Memento } from '../../hosts/extension-host/extension-host';
import { ScmHost, type SourceControlHistoryItem, type SourceControlHistoryProvider } from '../../hosts/scm/scm';
import type { CodeMirrorContext } from '../../hosts/source-editor/source-editor';
import type { SidePanel } from '../../hosts/window/window';
import { createVisualEditor, TEST_DOCUMENT_PATH } from '../../testing/testing';
import { changes, COMPARE_WITH_CURRENT, TOGGLE } from './changes';

afterEach(() => void vi.useRealTimers());

const SECOND: SourceControlHistoryItem = { id: 'b0a7b0a', parentIds: ['c0ffee1'], subject: 'Second', message: 'Second', displayId: 'b0a7b0a', author: 'Ann', timestamp: Date.now() };
const FIRST: SourceControlHistoryItem = { id: 'c0ffee1', parentIds: [], subject: 'First', message: 'First', displayId: 'c0ffee1', author: 'Ann', timestamp: Date.now() };

function setup(stored: Record<string, unknown> = {}) {
  vi.useFakeTimers();
  const scm = new ScmHost();
  const globalState: Memento = { get: (key: string) => stored[key] as never, update: async (key, value) => void (stored[key] = value) };
  const body = document.createElement('div');
  const side: SidePanel = { body, visible: true, onDidChangeVisibility: new EventEmitter<void>().event, setDefault() {}, setAvailable() {}, show() {}, dismiss() {}, dispose() {} };
  const statusBar = document.createElement('div');
  const codeMirrors: ((editor: CodeMirrorContext) => CodeExtension)[] = [];
  let context!: ExtensionContext;
  const extension = changes();
  const withScm: Extension = {
    ...extension,
    activate: (given) => {
      context = {
        ...given,
        scm,
        globalState,
        sourceEditor: { ...given.sourceEditor, registerCodeMirrorExtension: (_selector, codeMirror) => (codeMirrors.push(codeMirror as never), new Disposable(() => {})) },
        window: {
          ...given.window,
          ownerDocument: document,
          activeFile: TEST_DOCUMENT_PATH,
          onDidChangeActiveFile: new EventEmitter<never>().event,
          showDocument: () => {},
          registerSidePanel: () => side,
          registerStatusBarItem: (element) => (statusBar.append(element), new Disposable(() => element.remove())),
        },
      };
      extension.activate(context);
    },
  };
  const parent = document.createElement('div');
  const text = new TypstDocument('The slow brown fox.\n');
  createVisualEditor(parent, text, { contributions: [withScm] });
  const toggle = () => context.commands.executeCommand(TOGGLE);
  const command = (id: string, ...args: unknown[]) => context.commands.executeCommand(id, ...args);
  const inView = () => context.window.getMenuItems('window/view').find((item) => item.command === TOGGLE);
  const status = () => statusBar.querySelector<HTMLButtonElement>('[data-testid="zwf-changes-status"]');
  /** A Source editor of the document's text, with the extension's CodeMirror contribution. */
  const sourceEditor = () =>
    new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: 'The slow brown fox.\n',
        extensions: codeMirrors.map((codeMirror) => codeMirror({ editor: 'source', languageId: 'typst', document: text, path: () => TEST_DOCUMENT_PATH })),
      }),
    });
  const changed = new EventEmitter<void>();
  let base = 'The quick fox.\n';
  const historyProvider: SourceControlHistoryProvider = {
    currentHistoryItemRef: { id: SECOND.id, name: 'main' },
    provideHistoryItems: async () => ({ items: [SECOND, FIRST] }),
    provideHistoryItemChanges: async () => [],
    provideFileContent: async (id) => new TextEncoder().encode(id === 'c0ffee1' ? 'The slow fox.\n' : 'The brown fox.\n'),
    onDidChangeCurrentHistoryItem: new EventEmitter<void>().event,
  };
  const register = (history = false) =>
    scm.registerSourceControl({
      id: 'git',
      label: 'Git',
      busy: false,
      onDidChange: changed.event,
      commit: () => {},
      quickDiffProvider: { provideOriginalText: () => base },
      ...(history ? { historyProvider } : {}),
    });
  const moveBase = (text: string) => {
    base = text;
    changed.fire();
  };
  const settle = async () => {
    await vi.advanceTimersByTimeAsync(1000);
  };
  const row = (subject: string) => [...body.querySelectorAll<HTMLButtonElement>('.zwf-history__row')].find((each) => each.querySelector('.zwf-history__subject')?.textContent === subject)!;
  const compared = () => [...body.querySelectorAll('.zwf-history__row[aria-current="true"]')].map((each) => `${each.querySelector('.zwf-history__subject')!.textContent}: ${each.querySelector('.zwf-history__compared')!.textContent}`);
  const mode = () => body.querySelector('[data-testid="zwf-history-mode"]')?.textContent;
  return { parent, body, row, compared, mode, toggle, command, inView, status, sourceEditor, register, moveBase, settle, stored };
}

describe('changes', () => {
  it('offers the toggle in the View menu only while a source control has originals', async () => {
    const { inView, register, settle } = setup();
    await settle();
    expect(inView()).toBeUndefined();
    register();
    await settle();
    expect(inView()?.toggled?.({})).toBe(false);
  });

  it('shows new and deleted text in the Visual editor once toggled, follows the original, and remembers the choice', async () => {
    const { parent, toggle, inView, status, register, moveBase, settle, stored } = setup();
    register();
    await settle();
    expect(parent.querySelector('.zwf-changes__inserted')).toBeNull();
    expect(status()).toBeNull();
    await toggle();
    await settle();
    expect(stored.show).toBe(true);
    expect(inView()?.toggled?.({})).toBe(true);
    expect(status()?.textContent).toBe('Changes since last commit ✕');
    expect(parent.querySelector('.zwf-changes__inserted')?.textContent).toBe('slow brown');
    expect(parent.querySelector('del.zwf-changes__deleted')?.textContent).toBe('quick');

    moveBase('The slow brown fox.\n');
    expect(parent.querySelector('.zwf-changes__inserted')).toBeNull();
    expect(parent.querySelector('.zwf-changes__deleted')).toBeNull();
  });

  it('starts as the viewer chose last, the status bar entry only once a source control has originals', async () => {
    const { parent, status, register, settle } = setup({ show: true });
    await settle();
    expect(status()).toBeNull();
    register();
    await settle();
    expect(parent.querySelector('.zwf-changes__inserted')?.textContent).toBe('slow brown');
    expect(status()).not.toBeNull();
  });

  it('marks the changes in the Source editor too, the deleted lines read-only, and drops them when off', async () => {
    const { toggle, sourceEditor, register, moveBase, settle } = setup();
    register();
    await settle();
    const view = sourceEditor();
    expect(view.dom.querySelector('.cm-deletedChunk')).toBeNull();
    await toggle();
    await settle();
    expect(view.dom.classList.contains('zwf-changes-inline')).toBe(true);
    expect(view.dom.querySelector('.cm-changedLine')?.textContent).toContain('The slow brown fox.');
    expect(view.dom.querySelector('.cm-deletedChunk')?.textContent).toContain('The quick fox.');
    expect(view.state.doc.toString()).toBe('The slow brown fox.\n');

    moveBase('The slow fox.\n');
    await settle();
    expect(view.dom.querySelector('.cm-deletedChunk')?.textContent).toContain('The slow fox.');

    await toggle();
    await settle();
    expect(view.dom.querySelector('.cm-deletedChunk')).toBeNull();
    expect(view.dom.classList.contains('zwf-changes-inline')).toBe(false);
    view.destroy();
  });

  it('keeps the panel, the toggle, the status bar and the editors as one: A, A again, A then Cmd-click B, B with now, toggle, ✕', async () => {
    const { parent, body, row, compared, mode, toggle, command, inView, status, register, settle, stored } = setup();
    register(true);
    await settle();
    const state = () => ({
      compared: compared(),
      mode: mode(),
      toggled: inView()?.toggled?.({}),
      status: status()?.textContent,
      inserted: parent.querySelector('.zwf-changes__inserted')?.textContent?.trim(),
    });
    const off = { compared: [], mode: 'Show changes since last commit', toggled: false, status: undefined, inserted: undefined };
    expect(state()).toEqual(off);

    // the changes of a commit: its files as they were there, not marked in the live editor
    row('Second').click();
    await settle();
    expect(state()).toEqual({ compared: ['Second: Changes'], mode: 'Changes in b0a7b0a “Second”✕', toggled: true, status: 'Changes in b0a7b0a ✕', inserted: undefined });
    expect(stored.show).toBe(true);

    row('Second').click();
    await settle();
    expect(state()).toEqual(off);

    row('Second').click();
    row('First').dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }));
    await settle();
    expect(state()).toEqual({ compared: ['Second: To', 'First: From'], mode: 'Changes from c0ffee1 to b0a7b0a✕', toggled: true, status: 'Changes from c0ffee1 to b0a7b0a ✕', inserted: undefined });

    // the right click's "Compare with current state": the live editor marks the changes since it
    await command(COMPARE_WITH_CURRENT, FIRST);
    await settle();
    expect(state()).toMatchObject({ compared: ['First: Since'], mode: 'Changes since c0ffee1 (to now)✕', toggled: true, status: expect.stringMatching(/^Changes since c0ffee1 \(.+\) ✕$/), inserted: 'brown' });

    await toggle();
    await settle();
    expect(state()).toEqual(off);
    await toggle();
    await settle();
    expect(state()).toEqual({ compared: [], mode: 'Changes since last commit✕', toggled: true, status: 'Changes since last commit ✕', inserted: 'slow brown' });

    body.querySelector<HTMLButtonElement>('button[aria-label="Stop showing changes"]')!.click();
    await settle();
    expect(state()).toEqual(off);
    expect(stored.show).toBe(false);
  });
});
