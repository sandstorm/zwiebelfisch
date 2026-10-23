// @vitest-environment jsdom
// Tests for changes.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import { TypstDocument } from '../../core/typst-document/typst-document';
import type { Extension, Memento } from '../../hosts/extension-host/extension-host';
import { ScmHost } from '../../hosts/scm/scm';
import { createVisualEditor } from '../../testing/testing';
import { changes } from './changes';

afterEach(() => void vi.useRealTimers());

function setup(stored: Record<string, unknown> = {}) {
  vi.useFakeTimers();
  const scm = new ScmHost();
  const globalState: Memento = { get: (key: string) => stored[key] as never, update: async (key, value) => void (stored[key] = value) };
  const extension = changes();
  const withScm: Extension = { ...extension, activate: (context) => extension.activate({ ...context, scm, globalState }) };
  const parent = document.createElement('div');
  const editor = createVisualEditor(parent, new TypstDocument('The slow brown fox.\n'), { contributions: [withScm] });
  const button = () => parent.querySelector<HTMLButtonElement>('button[aria-label="Show changes since last commit"]');
  const changed = new EventEmitter<void>();
  let base = 'The quick fox.\n';
  const register = () =>
    scm.registerSourceControl({ id: 'git', label: 'Git', busy: false, onDidChange: changed.event, commit: () => {}, quickDiffProvider: { provideOriginalText: () => base } });
  const moveBase = (text: string) => {
    base = text;
    changed.fire();
  };
  const settle = () => vi.advanceTimersByTime(1000);
  return { parent, editor, button, register, moveBase, settle, stored };
}

describe('changes', () => {
  it('offers the toggle only for a file a source control has an original of', () => {
    const { button, register, settle } = setup();
    settle();
    expect(button()).toBeNull();
    register();
    settle();
    expect(button()?.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows new text and deleted text once toggled, follows the original, and remembers the choice', () => {
    const { parent, button, register, moveBase, settle, stored } = setup();
    register();
    settle();
    expect(parent.querySelector('.zwf-changes__inserted')).toBeNull();
    button()!.click();
    settle();
    expect(stored.show).toBe(true);
    expect(button()!.getAttribute('aria-pressed')).toBe('true');
    expect(parent.querySelector('.zwf-changes__inserted')?.textContent).toBe('slow brown');
    expect(parent.querySelector('del.zwf-changes__deleted')?.textContent).toBe('quick');

    moveBase('The slow brown fox.\n');
    expect(parent.querySelector('.zwf-changes__inserted')).toBeNull();
    expect(parent.querySelector('.zwf-changes__deleted')).toBeNull();
  });

  it('starts as the viewer chose last', () => {
    const { parent, register, settle } = setup({ show: true });
    register();
    settle();
    expect(parent.querySelector('.zwf-changes__inserted')?.textContent).toBe('slow brown');
  });
});
