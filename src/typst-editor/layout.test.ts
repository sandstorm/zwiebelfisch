// @vitest-environment jsdom
// Tests for layout.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Layout } from './layout';

let resize: (() => void) | null = null;

function setup({ observe = false, key = `test-${Math.random()}` } = {}) {
  if (observe) {
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    });
  }
  const host = document.createElement('div');
  document.body.append(host);
  const layout = new Layout(host, key);
  const body = layout.addPanel('files', { label: 'Files', icon: document.createElement('span') });
  body.textContent = 'tree';
  const toggle = host.querySelector<HTMLButtonElement>('[data-testid=typst-panel-toggle-files]')!;
  const panel = host.querySelector<HTMLElement>('.typst-editor__panel')!;
  const setWidth = (width: number) => {
    Object.defineProperty(host, 'clientWidth', { value: width, configurable: true });
    resize?.();
  };
  return { host, layout, body, toggle, panel, setWidth, key };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resize = null;
  sessionStorage.clear();
});

describe('Layout', () => {
  it('puts the side, the editing area and the preview into the host', () => {
    const { host, layout } = setup();
    expect([...host.children].map((c) => c.className)).toEqual(['typst-editor__side', 'typst-editor__left', 'typst-editor__right']);
    expect(layout.editor.className).toBe('typst-editor__left');
  });

  it('a panel is closed until its default says open; the rail button toggles it', () => {
    const { layout, body, toggle, panel } = setup();
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    layout.setDefault('files', true);
    expect(panel.hidden).toBe(false);
    expect(body.hidden).toBe(false);
    expect(layout.isOpen('files')).toBe(true);
    toggle.click();
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it("someone's choice wins over the default, also for the next widget in the session", () => {
    const { layout, toggle, key } = setup();
    toggle.click();
    layout.setDefault('files', false);
    expect(layout.isOpen('files')).toBe(true);
    const again = setup({ key });
    expect(again.layout.isOpen('files')).toBe(true);
  });

  it('an unavailable panel has no rail button, and with no panel there is no side at all', () => {
    const { host, layout, toggle } = setup();
    layout.setDefault('files', true);
    layout.setAvailable('files', false);
    expect(toggle.hidden).toBe(true);
    expect(layout.isOpen('files')).toBe(false);
    expect(host.querySelector<HTMLElement>('.typst-editor__side')!.hidden).toBe(true);
  });

  it('the separator changes the width (keys), within bounds, remembered', () => {
    const { host, layout, panel, key } = setup();
    layout.setDefault('files', true);
    const separator = host.querySelector<HTMLElement>('[role=separator]')!;
    expect(panel.style.width).toBe('240px');
    separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(panel.style.width).toBe('256px');
    for (let i = 0; i < 40; i++) separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(panel.style.width).toBe('160px');
    expect(separator.getAttribute('aria-valuenow')).toBe('160');
    expect(JSON.parse(sessionStorage.getItem(`${key}:layout`)!).width).toBe(160);
  });

  it('when narrow, the panel starts closed and is an overlay that closes on dismiss, Escape or a click outside', () => {
    const { host, layout, toggle, setWidth } = setup({ observe: true });
    layout.setDefault('files', true);
    setWidth(600);
    expect(host.classList.contains('typst-editor--narrow')).toBe(true);
    expect(layout.isOpen('files')).toBe(false);
    toggle.click();
    expect(layout.isOpen('files')).toBe(true);
    layout.dismiss();
    expect(layout.isOpen('files')).toBe(false);
    toggle.click();
    host.querySelector('.typst-editor__panel-body')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(layout.isOpen('files')).toBe(false);
    toggle.click();
    layout.editor.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(layout.isOpen('files')).toBe(false);
    setWidth(1200);
    expect(layout.isOpen('files')).toBe(true);
  });

  it('remembers values for the session', () => {
    const { layout } = setup();
    const memory = layout.remember<string[]>('folders');
    expect(memory.load()).toBeNull();
    memory.save(['/a']);
    expect(memory.load()).toEqual(['/a']);
  });
});
