// @vitest-environment jsdom
// Tests for changes.ts: the toggle in the Visual editor's toolbar against the last commit, and against a commit chosen
// in the History panel (its button "Show changes since this commit"), and back.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import { TypstDocument } from '../../core/typst-document/typst-document';
import type { Extension, Memento } from '../../hosts/extension-host/extension-host';
import { ScmHost, type SourceControlHistoryProvider } from '../../hosts/scm/scm';
import type { SidePanel } from '../../hosts/window/window';
import { createVisualEditor } from '../../testing/testing';
import { changes } from './changes';

afterEach(() => void vi.useRealTimers());

function setup(stored: Record<string, unknown> = {}) {
  vi.useFakeTimers();
  const scm = new ScmHost();
  const globalState: Memento = { get: (key: string) => stored[key] as never, update: async (key, value) => void (stored[key] = value) };
  const body = document.createElement('div');
  const side: SidePanel = { body, visible: true, onDidChangeVisibility: new EventEmitter<void>().event, setDefault() {}, setAvailable() {}, show() {}, dismiss() {}, dispose() {} };
  const extension = changes();
  const withScm: Extension = {
    ...extension,
    activate: (context) => extension.activate({ ...context, scm, globalState, window: { ...context.window, registerSidePanel: () => side } }),
  };
  const parent = document.createElement('div');
  const editor = createVisualEditor(parent, new TypstDocument('The slow brown fox.\n'), { contributions: [withScm] });
  const button = (label = 'Show changes since last commit') => parent.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
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
  return { parent, editor, body, button, register, moveBase, settle, stored };
}

describe('changes', () => {
  it('offers the toggle only for a file a source control has an original of', async () => {
    const { button, register, settle } = setup();
    await settle();
    expect(button()).toBeNull();
    register();
    await settle();
    expect(button()?.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows new text and deleted text once toggled, follows the original, and remembers the choice', async () => {
    const { parent, button, register, moveBase, settle, stored } = setup();
    register();
    await settle();
    expect(parent.querySelector('.zwf-changes__inserted')).toBeNull();
    button()!.click();
    await settle();
    expect(stored.show).toBe(true);
    expect(button()!.getAttribute('aria-pressed')).toBe('true');
    expect(parent.querySelector('.zwf-changes__inserted')?.textContent).toBe('slow brown');
    expect(parent.querySelector('del.zwf-changes__deleted')?.textContent).toBe('quick');

    moveBase('The slow brown fox.\n');
    expect(parent.querySelector('.zwf-changes__inserted')).toBeNull();
    expect(parent.querySelector('.zwf-changes__deleted')).toBeNull();
  });

  it('starts as the viewer chose last', async () => {
    const { parent, register, settle } = setup({ show: true });
    register();
    await settle();
    expect(parent.querySelector('.zwf-changes__inserted')?.textContent).toBe('slow brown');
  });

  it('shows the changes since a commit chosen in History, and since the last commit again', async () => {
    const { parent, body, button, register, settle, stored } = setup();
    register(true);
    await settle();
    expect(body.textContent).toContain('First');
    expect(button('Since last commit')).toBeNull();

    body.querySelector<HTMLButtonElement>('button[aria-label="Show changes since this commit"]')!.click();
    await settle();
    expect(stored.show).toBe(true);
    expect(parent.querySelector('.zwf-changes__inserted')?.textContent?.trim()).toBe('brown');
    expect(parent.querySelector('.zwf-changes__deleted')).toBeNull();
    expect(body.textContent).toContain('Changes shown since c0ffee1');

    button('Since last commit')!.click();
    await settle();
    expect(parent.querySelector('.zwf-changes__inserted')?.textContent).toBe('slow brown');
    expect(button('Since last commit')).toBeNull();
    expect(body.textContent).not.toContain('Changes shown since');
  });
});
