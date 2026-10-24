// @vitest-environment jsdom
// Tests for changes.ts: one toggle (the View menu's) shows the changes in the Visual and the Source editor against the
// last commit, or against a commit chosen in the History panel; the status bar says since when and turns them off.
import { EditorState, type Extension as CodeExtension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../core/disposable/disposable';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import { TypstDocument } from '../../core/typst-document/typst-document';
import type { Extension, ExtensionContext, Memento } from '../../hosts/extension-host/extension-host';
import { ScmHost, type SourceControlHistoryProvider } from '../../hosts/scm/scm';
import type { CodeMirrorContext } from '../../hosts/source-editor/source-editor';
import type { SidePanel } from '../../hosts/window/window';
import { createVisualEditor, TEST_DOCUMENT_PATH } from '../../testing/testing';
import { changes, TOGGLE } from './changes';

afterEach(() => void vi.useRealTimers());

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
    provideHistoryItems: async () => ({ items: [{ id: 'c0ffee1', parentIds: [], subject: 'First', message: 'First', displayId: 'c0ffee1', author: 'Ann', timestamp: Date.now() }] }),
    provideHistoryItemChanges: async () => [],
    provideFileContent: async () => new TextEncoder().encode('The slow fox.\n'),
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
  return { parent, body, toggle, inView, status, sourceEditor, register, moveBase, settle, stored };
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

  it('starts as the viewer chose last', async () => {
    const { parent, status, register, settle } = setup({ show: true });
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

  it('shows the changes since a commit chosen in History, says so in the status bar, and turns off back to the last commit', async () => {
    const { parent, body, toggle, status, register, settle, stored } = setup();
    register(true);
    await settle();
    expect(body.textContent).toContain('First');

    body.querySelector<HTMLButtonElement>('.zwf-history__row[title^="Show changes since this commit"]')!.click();
    await settle();
    expect(stored.show).toBe(true);
    expect(parent.querySelector('.zwf-changes__inserted')?.textContent?.trim()).toBe('brown');
    expect(parent.querySelector('.zwf-changes__deleted')).toBeNull();
    expect(status()?.textContent).toMatch(/^Changes since c0ffee1 \(.+\) ✕$/);
    expect(body.querySelector('.zwf-history__row[aria-current="true"]')).not.toBeNull();

    status()!.click();
    await settle();
    expect(stored.show).toBe(false);
    expect(status()).toBeNull();
    expect(parent.querySelector('.zwf-changes__inserted')).toBeNull();
    expect(body.querySelector('.zwf-history__row[aria-current="true"]')).toBeNull();

    await toggle();
    await settle();
    expect(parent.querySelector('.zwf-changes__inserted')?.textContent).toBe('slow brown');
    expect(status()?.textContent).toBe('Changes since last commit ✕');
  });
});
