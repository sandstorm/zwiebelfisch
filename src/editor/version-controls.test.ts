// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { ServerMessage } from '../collab/gitlab-protocol';
import { VersionControls } from './version-controls';

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((fn) => fn()));

function setup() {
  let base: Record<string, string> = { '/main.typ': 'v1' };
  const baseListeners = new Set<() => void>();
  const messageListeners = new Set<(message: ServerMessage) => void>();
  const saved: { message: string; author?: { name: string } }[] = [];
  const versions = {
    base: (path: string) => base[path] ?? null,
    onBaseChange: (listener: () => void) => (baseListeners.add(listener), () => void baseListeners.delete(listener)),
    save: (message: string, author?: { name: string }) => void saved.push({ message, author }),
    onMessage: (listener: (message: ServerMessage) => void) => (messageListeners.add(listener), () => void messageListeners.delete(listener)),
  };
  const bases: (string | null)[] = [];
  const toolbar = document.createElement('div');
  document.body.append(toolbar);
  const controls = new VersionControls(toolbar, versions, { path: '/main.typ', user: { name: 'Ann' }, setBase: (b) => bases.push(b) });
  cleanup.push(() => controls.destroy(), () => toolbar.remove());
  const button = toolbar.querySelector<HTMLButtonElement>('.typst-editor__save-version')!;
  const status = toolbar.querySelector('[role=status]')!;
  return {
    toolbar,
    button,
    status,
    saved,
    bases,
    setBase(next: Record<string, string>) {
      base = next;
      baseListeners.forEach((listener) => listener());
    },
    receive: (message: ServerMessage) => messageListeners.forEach((listener) => listener(message)),
  };
}

describe('VersionControls', () => {
  it('shows the changes against the last commit and follows it', () => {
    const { bases, setBase } = setup();
    expect(bases).toEqual(['v1']);
    setBase({ '/main.typ': 'v2' });
    expect(bases).toEqual(['v1', 'v2']);
  });

  it('asks for a commit message, saves as the user, and shows the outcome', () => {
    const { toolbar, button, status, saved, receive } = setup();
    button.click();
    const form = toolbar.querySelector<HTMLFormElement>('form[aria-label="Save version"]')!;
    expect(form.hidden).toBe(false);
    const input = form.querySelector('input')!;
    expect(input.value).toBe('Edit via Typst editor');
    input.value = 'Fix the intro';
    form.requestSubmit();
    expect(saved).toEqual([{ message: 'Fix the intro', author: { name: 'Ann' } }]);
    expect(button.disabled).toBe(true);
    expect(status.textContent).toBe('Saving…');
    receive({ type: 'gitlab:saved', sha: '0123456789abcdef', author: 'Ann' });
    expect(button.disabled).toBe(false);
    expect(status.textContent).toBe('Saved version 01234567 (Ann)');
  });

  it('reports conflicts by file', () => {
    const { status, receive } = setup();
    receive({ type: 'gitlab:conflict', sha: 's', files: [{ path: '/main.typ', ranges: [{ from: 0, to: 3 }] }] });
    expect(status.textContent).toContain('/main.typ');
  });
});
