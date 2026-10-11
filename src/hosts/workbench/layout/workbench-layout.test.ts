// @vitest-environment jsdom
// Tests for workbench-layout.ts (WorkbenchLayout) and its two sides (side-bar.ts).
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StorageMemento } from '../memento/memento';
import { WorkbenchLayout } from './workbench-layout';

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
  const layout = new WorkbenchLayout(host, StorageMemento.of(document, 'sessionStorage', `${key}:`));
  const sidePanel = layout.addPanel('files', { label: 'Files', icon: document.createElement('span') });
  const body = sidePanel.body;
  body.textContent = 'tree';
  const toggle = host.querySelector<HTMLButtonElement>('[data-testid=typst-panel-toggle-files]')!;
  const panel = host.querySelector<HTMLElement>('.typst-editor__side--left .typst-editor__panel')!;
  const setWidth = (width: number) => {
    Object.defineProperty(host, 'clientWidth', { value: width, configurable: true });
    resize?.();
  };
  /** Whether the panel is open, as people see it: its rail button pressed and its body shown. */
  const isOpen = () => toggle.getAttribute('aria-pressed') === 'true' && !panel.hidden && !body.hidden;
  /** Adds the right side's panel `id`. */
  const right = (id = 'preview', label = 'Preview') => layout.addPanel(id, { label, icon: document.createElement('span'), side: 'right' });
  return { host, layout, sidePanel, body, toggle, panel, setWidth, key, isOpen, right };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resize = null;
  sessionStorage.clear();
});

describe('WorkbenchLayout', () => {
  it('puts the left side, the editing area, the right side and the status bar into the host', () => {
    const { host, layout } = setup();
    expect([...host.children].map((c) => c.className)).toEqual([
      'typst-editor__side typst-editor__side--left',
      'typst-editor__editor-area',
      'typst-editor__side typst-editor__side--right',
      'typst-editor__status-bar',
    ]);
    expect(layout.editor.className).toBe('typst-editor__editor-area');
    expect(layout.statusBar.className).toBe('typst-editor__status-bar');
  });

  it('places rail buttons by order, equal orders in registration order', () => {
    const { host, layout } = setup();
    const icon = () => document.createElement('span');
    layout.addPanel('outline', { label: 'Outline', icon: icon(), order: -10 });
    layout.addPanel('search', { label: 'Search', icon: icon(), order: 20 });
    layout.addPanel('comments', { label: 'Comments', icon: icon() });
    const rail = [...host.querySelectorAll<HTMLElement>('.typst-editor__rail-button')].map((button) => button.title);
    expect(rail).toEqual(['Outline', 'Files', 'Comments', 'Search']);
  });

  it("places a rail action among the panels' buttons by order, and bottom-aligned panels in the rail's far-end group", () => {
    const { host, layout } = setup();
    const icon = () => document.createElement('span');
    layout.addPanel('help', { label: 'Help', icon: icon(), order: 20 });
    layout.addPanel('settings', { label: 'Settings', icon: icon(), alignment: 'bottom', order: 5 });
    layout.addPanel('account', { label: 'Account', icon: icon(), alignment: 'bottom' });
    const action = document.createElement('button');
    action.title = 'Run';
    layout.addRailAction('left', action, 15);
    layout.addPanel('outline', { label: 'Outline', icon: icon(), order: 15 });
    const titles = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)].map((button) => button.title);
    expect(titles('.typst-editor__rail > .typst-editor__rail-button')).toEqual(['Files', 'Run', 'Outline', 'Help']);
    expect(titles('.typst-editor__rail-bottom > .typst-editor__rail-button')).toEqual(['Account', 'Settings']);
    // the bottom group comes after every top button
    expect(host.querySelector('.typst-editor__rail')!.lastElementChild!.className).toBe('typst-editor__rail-bottom');
  });

  it('removes a panel and its rail button', () => {
    const { host, sidePanel } = setup();
    sidePanel.setDefault(true);
    sidePanel.dispose();
    expect(host.querySelector('[data-panel=files]')).toBeNull();
    expect(host.querySelector('[data-testid=typst-panel-toggle-files]')).toBeNull();
    expect(host.querySelector<HTMLElement>('.typst-editor__side--left')!.hidden).toBe(true);
  });

  it('the right side column is a share of the widget, so an opening left panel narrows only the editing column', () => {
    // Regression (image-upload.spec): with `1fr 1fr` the panel's width came out of both columns and the preview moved.
    const css = readFileSync('src/typst-editor/typst-editor.css', 'utf8');
    const columns = /\.typst-editor \{[^}]*grid-template-columns:\s*([^;]+);/.exec(css)?.[1].trim();
    expect(columns).toBe('auto minmax(min(20rem, 25%), 1fr) var(--te-right-side, auto)');
  });

  it('a panel is closed until its default says open; the rail button toggles it', () => {
    const { sidePanel, body, toggle, panel, isOpen } = setup();
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    sidePanel.setDefault(true);
    expect(panel.hidden).toBe(false);
    expect(body.hidden).toBe(false);
    expect(isOpen()).toBe(true);
    toggle.click();
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it("someone's choice wins over the default, also for the next widget in the session", () => {
    const { sidePanel, toggle, key, isOpen } = setup();
    toggle.click();
    sidePanel.setDefault(false);
    expect(isOpen()).toBe(true);
    const again = setup({ key });
    expect(again.isOpen()).toBe(true);
  });

  it('an unavailable panel has no rail button, and with no panel there is no side at all', () => {
    const { host, sidePanel, toggle, isOpen } = setup();
    sidePanel.setDefault(true);
    sidePanel.setAvailable(false);
    expect(toggle.hidden).toBe(true);
    expect(isOpen()).toBe(false);
    expect(host.querySelector<HTMLElement>('.typst-editor__side--left')!.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>('.typst-editor__side--right')!.hidden).toBe(true);
  });

  it("a right panel goes on the right rail; one panel per side shows: the viewer's pick, else the side's default", () => {
    const { host, layout, sidePanel, isOpen, right } = setup();
    sidePanel.setDefault(true);
    const preview = right();
    const devtools = right('devtools', 'Devtools');
    const rail = (side: string) => [...host.querySelectorAll<HTMLElement>(`.typst-editor__side--${side} .typst-editor__rail-button`)].map((button) => button.title);
    expect(rail('left')).toEqual(['Files']);
    expect(rail('right')).toEqual(['Preview', 'Devtools']);
    expect(host.querySelector<HTMLElement>('.typst-editor__side--right')!.hidden).toBe(false);
    // no default named, none asked for: the right side is only its rail
    expect([preview.body.hidden, devtools.body.hidden]).toEqual([true, true]);
    expect(host.style.getPropertyValue('--te-right-side')).toBe('');
    layout.setDefaultPanel('right', 'preview');
    expect(preview.body.hidden).toBe(false);
    expect(host.style.getPropertyValue('--te-right-side')).toBe('minmax(0, 50%)');
    host.querySelector<HTMLElement>('[data-testid=typst-panel-toggle-devtools]')!.click();
    expect([preview.body.hidden, devtools.body.hidden]).toEqual([true, false]);
    expect(isOpen()).toBe(true); // the left side is apart
  });

  it("clicking the shown panel's rail button hides its side (the editing area takes the room), remembered over the default", () => {
    const { host, layout, key, right } = setup();
    const preview = right();
    layout.setDefaultPanel('right', 'preview');
    const toggle = host.querySelector<HTMLElement>('[data-testid=typst-panel-toggle-preview]')!;
    toggle.click();
    expect(preview.body.hidden).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(host.style.getPropertyValue('--te-right-side')).toBe('');
    const next = setup({ key });
    const again = next.right();
    next.layout.setDefaultPanel('right', 'preview');
    expect(again.body.hidden).toBe(true);
  });

  it('a default of null starts the side hidden; a default not registered falls back to the panel asking for it', () => {
    const { layout, right } = setup();
    const preview = right();
    preview.setDefault(true);
    layout.setDefaultPanel('right', null);
    expect(preview.body.hidden).toBe(true);
    layout.setDefaultPanel('right', 'devtools');
    expect(preview.body.hidden).toBe(false);
  });

  it('refuses a panel id used on the other side', () => {
    const { right } = setup();
    expect(() => right('files')).toThrow(/already/);
  });

  it("the right separator sets the right side's share of the widget (keys: the edge moves with the arrow), 20–80%, remembered", () => {
    const { host, layout, key, right } = setup();
    right();
    layout.setDefaultPanel('right', 'preview');
    const split = host.querySelector<HTMLElement>('.typst-editor__side--right [role=separator]')!;
    expect(split.getAttribute('aria-label')).toBe('Right panel width');
    expect(split.tabIndex).toBe(0);
    split.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(host.style.getPropertyValue('--te-right-side')).toBe('minmax(0, 55%)');
    for (let i = 0; i < 20; i++) split.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(host.style.getPropertyValue('--te-right-side')).toBe('minmax(0, 20%)');
    expect(split.getAttribute('aria-valuenow')).toBe('20');
    expect(JSON.parse(sessionStorage.getItem(`${key}:layout`)!).right.size).toBe(20);
    const next = setup({ key });
    next.right();
    next.layout.setDefaultPanel('right', 'preview');
    expect(next.host.style.getPropertyValue('--te-right-side')).toBe('minmax(0, 20%)');
  });

  it('ignores a remembered layout of another shape', () => {
    const key = `test-${Math.random()}`;
    sessionStorage.setItem(`${key}:layout`, JSON.stringify({ width: 'wide', left: { size: 'x', chosen: 3 } }));
    const { panel, sidePanel, isOpen } = setup({ key });
    sidePanel.setDefault(true);
    expect(isOpen()).toBe(true);
    expect(panel.style.width).toBe('240px');
  });

  it('the left separator changes the width (keys), within bounds, remembered', () => {
    const { host, sidePanel, panel, key } = setup();
    sidePanel.setDefault(true);
    const separator = host.querySelector<HTMLElement>('.typst-editor__side--left [role=separator]')!;
    expect(separator.getAttribute('aria-label')).toBe('Left panel width');
    expect(panel.style.width).toBe('240px');
    separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(panel.style.width).toBe('256px');
    for (let i = 0; i < 40; i++) separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(panel.style.width).toBe('160px');
    expect(separator.getAttribute('aria-valuenow')).toBe('160');
    expect(JSON.parse(sessionStorage.getItem(`${key}:layout`)!).left.size).toBe(160);
  });

  it('when narrow, the left panel starts closed and is an overlay that closes on dismiss, Escape or a click outside', () => {
    const { host, layout, sidePanel, toggle, setWidth, isOpen } = setup({ observe: true });
    sidePanel.setDefault(true);
    setWidth(600);
    expect(host.classList.contains('typst-editor--narrow')).toBe(true);
    expect(isOpen()).toBe(false);
    toggle.click();
    expect(isOpen()).toBe(true);
    sidePanel.dismiss();
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

  it('when narrow, the right side stays beside the editing area', () => {
    const { layout, setWidth, right } = setup({ observe: true });
    const preview = right();
    layout.setDefaultPanel('right', 'preview');
    setWidth(600);
    expect(preview.body.hidden).toBe(false);
    layout.editor.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(preview.body.hidden).toBe(false);
  });
});
