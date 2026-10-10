// @vitest-environment jsdom
// Tests for layout.ts.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionMemory } from '../memory/session-memory';
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
  const layout = new Layout(host, new SessionMemory(document, key));
  const body = layout.addPanel('files', { label: 'Files', icon: document.createElement('span') });
  body.textContent = 'tree';
  const toggle = host.querySelector<HTMLButtonElement>('[data-testid=typst-panel-toggle-files]')!;
  const panel = host.querySelector<HTMLElement>('.typst-editor__panel')!;
  const setWidth = (width: number) => {
    Object.defineProperty(host, 'clientWidth', { value: width, configurable: true });
    resize?.();
  };
  /** Whether the panel is open, as people see it: its rail button pressed and its body shown. */
  const isOpen = () => toggle.getAttribute('aria-pressed') === 'true' && !panel.hidden && !body.hidden;
  return { host, layout, body, toggle, panel, setWidth, key, isOpen };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resize = null;
  sessionStorage.clear();
});

describe('Layout', () => {
  it('puts the side, the editing area, the preview and the status bar into the host', () => {
    const { host, layout } = setup();
    expect([...host.children].map((c) => c.className)).toEqual(['typst-editor__side', 'typst-editor__left', 'typst-editor__right', 'typst-editor__status-bar']);
    expect(layout.editor.className).toBe('typst-editor__left');
    expect(layout.statusBar.className).toBe('typst-editor__status-bar');
  });

  it('removes a panel and its rail button', () => {
    const { host, layout } = setup();
    layout.setDefault('files', true);
    layout.removePanel('files');
    expect(host.querySelector('[data-panel=files]')).toBeNull();
    expect(host.querySelector('[data-testid=typst-panel-toggle-files]')).toBeNull();
    expect(host.querySelector<HTMLElement>('.typst-editor__side')!.hidden).toBe(true);
  });

  it('the preview column is a share of the widget, so an opening side panel narrows only the editing column', () => {
    // Regression (image-upload.spec): with `1fr 1fr` the panel's width came out of both columns and the preview moved.
    const css = readFileSync('src/typst-editor/typst-editor.css', 'utf8');
    const columns = /\.typst-editor \{[^}]*grid-template-columns:\s*([^;]+);/.exec(css)?.[1].trim();
    expect(columns).toBe('auto minmax(min(20rem, 25%), 1fr) minmax(0, var(--te-preview-share, 50%))');
  });

  it('a panel is closed until its default says open; the rail button toggles it', () => {
    const { layout, body, toggle, panel, isOpen } = setup();
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    layout.setDefault('files', true);
    expect(panel.hidden).toBe(false);
    expect(body.hidden).toBe(false);
    expect(isOpen()).toBe(true);
    toggle.click();
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it("someone's choice wins over the default, also for the next widget in the session", () => {
    const { layout, toggle, key, isOpen } = setup();
    toggle.click();
    layout.setDefault('files', false);
    expect(isOpen()).toBe(true);
    const again = setup({ key });
    expect(again.isOpen()).toBe(true);
  });

  it('an unavailable panel has no rail button, and with no panel there is no side at all', () => {
    const { host, layout, toggle, isOpen } = setup();
    layout.setDefault('files', true);
    layout.setAvailable('files', false);
    expect(toggle.hidden).toBe(true);
    expect(isOpen()).toBe(false);
    expect(host.querySelector<HTMLElement>('.typst-editor__side')!.hidden).toBe(true);
  });

  it('the separator between editing area and preview sets the preview share (keys), 20–80%, remembered', () => {
    const { host, key } = setup();
    const split = host.querySelector<HTMLElement>('.typst-editor__right > [role=separator]')!;
    expect(split.getAttribute('aria-label')).toBe('Preview width');
    expect(host.style.getPropertyValue('--te-preview-share')).toBe('50%');
    split.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(host.style.getPropertyValue('--te-preview-share')).toBe('55%');
    for (let i = 0; i < 20; i++) split.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(host.style.getPropertyValue('--te-preview-share')).toBe('20%');
    expect(split.getAttribute('aria-valuenow')).toBe('20');
    expect(JSON.parse(sessionStorage.getItem(`${key}:layout`)!).preview).toBe(20);
    const next = setup({ key });
    expect(next.host.style.getPropertyValue('--te-preview-share')).toBe('20%');
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
    const { host, layout, toggle, setWidth, isOpen } = setup({ observe: true });
    layout.setDefault('files', true);
    setWidth(600);
    expect(host.classList.contains('typst-editor--narrow')).toBe(true);
    expect(isOpen()).toBe(false);
    toggle.click();
    expect(isOpen()).toBe(true);
    layout.dismiss();
    expect(isOpen()).toBe(false);
    toggle.click();
    host.querySelector('.typst-editor__panel-body')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(isOpen()).toBe(false);
    toggle.click();
    host.querySelector('.typst-editor__panel-body')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(isOpen()).toBe(true);
    layout.editor.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(isOpen()).toBe(false);
    setWidth(1200);
    expect(isOpen()).toBe(true);
  });
});
