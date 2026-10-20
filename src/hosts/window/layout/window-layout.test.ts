// @vitest-environment jsdom
// Tests for window-layout.ts (WindowLayout) and its two sides (side-bar.ts).
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandsHost } from '../../commands/commands';
import { WindowLayout } from './window-layout';

let resize: (() => void) | null = null;

/** The layout's state in the session storage under `prefix`, as JSON (as the widget keeps it). */
function sessionMemento(prefix: string) {
  return {
    get: <T>(key: string): T | undefined => {
      const text = sessionStorage.getItem(prefix + key);
      return text == null ? undefined : (JSON.parse(text) as T);
    },
    update: async (key: string, value: unknown) => sessionStorage.setItem(prefix + key, JSON.stringify(value)),
  };
}

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
  const commands = new CommandsHost(host);
  const layout = new WindowLayout(host, sessionMemento(`${key}:`), commands);
  const sidePanel = layout.addPanel('files', { label: 'Files', icon: '<svg></svg>' });
  const body = sidePanel.body;
  body.textContent = 'tree';
  const toggle = host.querySelector<HTMLButtonElement>('[data-testid=zwf-panel-toggle-files]')!;
  const panel = host.querySelector<HTMLElement>('.zwf-editor__side--left .zwf-editor__panel')!;
  const setWidth = (width: number) => {
    Object.defineProperty(host, 'clientWidth', { value: width, configurable: true });
    resize?.();
  };
  /** Whether the panel is open, as people see it: its rail button pressed and its body shown. */
  const isOpen = () => toggle.getAttribute('aria-pressed') === 'true' && !panel.hidden && !body.hidden;
  /** Adds the right side's panel `id`. */
  const right = (id = 'preview', label = 'Preview') => layout.addPanel(id, { label, icon: '<svg></svg>', side: 'right' });
  return { host, layout, commands, sidePanel, body, toggle, panel, setWidth, key, isOpen, right };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resize = null;
  sessionStorage.clear();
});

describe('WindowLayout', () => {
  it('puts the left side, the editing area, the right side and the status bar into the host', () => {
    const { host, layout } = setup();
    expect([...host.children].map((c) => c.className)).toEqual([
      'zwf-editor__side zwf-editor__side--left',
      'zwf-editor__editor-area',
      'zwf-editor__side zwf-editor__side--right',
      'zwf-editor__status-bar',
    ]);
    expect(layout.editor.className).toBe('zwf-editor__editor-area');
    expect(layout.statusBar.className).toBe('zwf-editor__status-bar');
  });

  it('places rail buttons by order, equal orders in registration order', () => {
    const { host, layout } = setup();
    const icon = () => '<svg></svg>';
    layout.addPanel('outline', { label: 'Outline', icon: icon(), order: -10 });
    layout.addPanel('search', { label: 'Search', icon: icon(), order: 20 });
    layout.addPanel('comments', { label: 'Comments', icon: icon() });
    const rail = [...host.querySelectorAll<HTMLElement>('.zwf-editor__rail-button')].map((button) => button.title);
    expect(rail).toEqual(['Outline', 'Files', 'Comments', 'Search']);
  });

  it("places a rail action among the panels' buttons by order, and bottom-aligned panels in the rail's far-end group", () => {
    const { host, layout } = setup();
    const icon = () => '<svg></svg>';
    layout.addPanel('help', { label: 'Help', icon: icon(), order: 20 });
    layout.addPanel('settings', { label: 'Settings', icon: icon(), alignment: 'bottom', order: 5 });
    layout.addPanel('account', { label: 'Account', icon: icon(), alignment: 'bottom' });
    layout.setRailActions('left', [{ command: 'test.run', title: 'Run', icon: '<svg></svg>', order: 15 }]);
    layout.addPanel('outline', { label: 'Outline', icon: icon(), order: 15 });
    const titles = (selector: string) => [...host.querySelectorAll<HTMLElement>(selector)].map((button) => button.title);
    expect(titles('.zwf-editor__rail > .zwf-editor__rail-button')).toEqual(['Files', 'Run', 'Outline', 'Help']);
    layout.setRailActions('left', []);
    expect(titles('.zwf-editor__rail > .zwf-editor__rail-button')).toEqual(['Files', 'Outline', 'Help']);
    expect(titles('.zwf-editor__rail-bottom > .zwf-editor__rail-button')).toEqual(['Account', 'Settings']);
    // the bottom group comes after every top button
    expect(host.querySelector('.zwf-editor__rail')!.lastElementChild!.className).toBe('zwf-editor__rail-bottom');
  });

  it('removes a panel and its rail button', () => {
    const { host, sidePanel } = setup();
    sidePanel.setDefault(true);
    sidePanel.dispose();
    expect(host.querySelector('[data-panel=files]')).toBeNull();
    expect(host.querySelector('[data-testid=zwf-panel-toggle-files]')).toBeNull();
    expect(host.querySelector<HTMLElement>('.zwf-editor__side--left')!.hidden).toBe(true);
  });

  it('the right side column is a share of the widget, so an opening left panel narrows only the editing column', () => {
    // Regression (image-upload.spec): with `1fr 1fr` the panel's width came out of both columns and the preview moved.
    const css = readFileSync('src/editor/editor.css', 'utf8');
    const columns = /\.zwf-editor \{[^}]*grid-template-columns:\s*([^;]+);/.exec(css)?.[1].trim();
    expect(columns).toBe('auto minmax(min(20rem, 25%), 1fr) var(--zwf-right-side, auto)');
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
    expect(host.querySelector<HTMLElement>('.zwf-editor__side--left')!.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>('.zwf-editor__side--right')!.hidden).toBe(true);
  });

  it("a right panel goes on the right rail; one panel per side shows: the viewer's pick, else the side's default", () => {
    const { host, layout, sidePanel, isOpen, right } = setup();
    sidePanel.setDefault(true);
    const preview = right();
    const devtools = right('devtools', 'Devtools');
    const rail = (side: string) => [...host.querySelectorAll<HTMLElement>(`.zwf-editor__side--${side} .zwf-editor__rail-button`)].map((button) => button.title);
    expect(rail('left')).toEqual(['Files']);
    expect(rail('right')).toEqual(['Preview', 'Devtools']);
    expect(host.querySelector<HTMLElement>('.zwf-editor__side--right')!.hidden).toBe(false);
    // no default named, none asked for: the right side is only its rail
    expect([preview.body.hidden, devtools.body.hidden]).toEqual([true, true]);
    expect(host.style.getPropertyValue('--zwf-right-side')).toBe('');
    layout.setDefaultPanel('right', 'preview');
    expect(preview.body.hidden).toBe(false);
    expect(host.style.getPropertyValue('--zwf-right-side')).toBe('minmax(0, 50%)');
    host.querySelector<HTMLElement>('[data-testid=zwf-panel-toggle-devtools]')!.click();
    expect([preview.body.hidden, devtools.body.hidden]).toEqual([true, false]);
    expect(isOpen()).toBe(true); // the left side is apart
  });

  it("clicking the shown panel's rail button hides its side (the editing area takes the room), remembered over the default", () => {
    const { host, layout, key, right } = setup();
    const preview = right();
    layout.setDefaultPanel('right', 'preview');
    const toggle = host.querySelector<HTMLElement>('[data-testid=zwf-panel-toggle-preview]')!;
    toggle.click();
    expect(preview.body.hidden).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(host.style.getPropertyValue('--zwf-right-side')).toBe('');
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
    const split = host.querySelector<HTMLElement>('.zwf-editor__side--right [role=separator]')!;
    expect(split.getAttribute('aria-label')).toBe('Right panel width');
    expect(split.tabIndex).toBe(0);
    split.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(host.style.getPropertyValue('--zwf-right-side')).toBe('minmax(0, 55%)');
    for (let i = 0; i < 20; i++) split.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(host.style.getPropertyValue('--zwf-right-side')).toBe('minmax(0, 20%)');
    expect(split.getAttribute('aria-valuenow')).toBe('20');
    expect(JSON.parse(sessionStorage.getItem(`${key}:layout`)!).right.size).toBe(20);
    const next = setup({ key });
    next.right();
    next.layout.setDefaultPanel('right', 'preview');
    expect(next.host.style.getPropertyValue('--zwf-right-side')).toBe('minmax(0, 20%)');
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
    const separator = host.querySelector<HTMLElement>('.zwf-editor__side--left [role=separator]')!;
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
    expect(host.classList.contains('zwf-editor--narrow')).toBe(true);
    expect(isOpen()).toBe(false);
    toggle.click();
    expect(isOpen()).toBe(true);
    sidePanel.dismiss();
    expect(isOpen()).toBe(false);
    toggle.click();
    host.querySelector('.zwf-editor__panel-body')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(isOpen()).toBe(false);
    toggle.click();
    host.querySelector('.zwf-editor__panel-body')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(isOpen()).toBe(true);
    layout.editor.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(isOpen()).toBe(false);
    setWidth(1200);
    expect(isOpen()).toBe(true);
  });

  it('tells whether a panel is visible: shown, open as the narrow overlay, not when removed or another one shows', () => {
    const { layout, sidePanel, toggle, setWidth, right } = setup({ observe: true });
    const changes: boolean[] = [];
    sidePanel.onDidChangeVisibility(() => changes.push(sidePanel.visible));
    expect(sidePanel.visible).toBe(false);
    sidePanel.setDefault(true);
    toggle.click();
    toggle.click();
    expect(changes).toEqual([true, false, true]);

    setWidth(600);
    toggle.click();
    expect(sidePanel.visible).toBe(true);
    sidePanel.dismiss();
    sidePanel.setAvailable(false);
    toggle.click();
    expect(changes).toEqual([true, false, true, false, true, false]);
    setWidth(1200);
    expect(sidePanel.visible).toBe(false);
    sidePanel.setAvailable(true);
    expect(changes.at(-1)).toBe(true);

    const preview = right();
    const devtools = right('devtools', 'Devtools');
    const devtoolsChanges: boolean[] = [];
    devtools.onDidChangeVisibility(() => devtoolsChanges.push(devtools.visible));
    layout.setDefaultPanel('right', 'devtools');
    expect([preview.visible, devtools.visible]).toEqual([false, true]);
    layout.setDefaultPanel('right', 'preview');
    expect([preview.visible, devtools.visible]).toEqual([true, false]);
    expect(devtoolsChanges).toEqual([true, false]);
  });

  it('show() picks the panel as the rail would and focuses its first control, unless asked to keep the focus', () => {
    const { host, layout, sidePanel, body, isOpen } = setup();
    const field = body.appendChild(document.createElement('input'));
    sidePanel.show(true);
    expect(isOpen()).toBe(true);
    expect(document.activeElement).not.toBe(field);
    sidePanel.show();
    expect(document.activeElement).toBe(field);
    // an element marked autofocus before the first control
    const query = body.appendChild(document.createElement('input'));
    query.autofocus = true;
    sidePanel.show();
    expect(document.activeElement).toBe(query);
    // a panel with nothing to focus gets the focus itself
    const preview = layout.addPanel('preview', { label: 'Preview', icon: '<svg></svg>', side: 'right' });
    preview.show();
    expect(document.activeElement).toBe(preview.body);
    expect(host.querySelector('[data-testid=zwf-panel-toggle-preview]')!.getAttribute('aria-pressed')).toBe('true');
    sidePanel.setAvailable(false);
    sidePanel.show();
    expect(sidePanel.visible).toBe(false);
  });

  it("workbench.view.<id> shows and focuses the panel, or hides it when it has the focus (the focus back where it was), until disposed", async () => {
    const { layout, commands, sidePanel, body, isOpen } = setup();
    const field = body.appendChild(document.createElement('input'));
    const editor = layout.editor.appendChild(document.createElement('textarea'));
    editor.focus();
    await commands.executeCommand('workbench.view.files');
    expect([isOpen(), document.activeElement]).toEqual([true, field]);
    await commands.executeCommand('workbench.view.files');
    expect([isOpen(), document.activeElement]).toEqual([false, editor]);
    // shown but the focus elsewhere: focused, not hidden
    sidePanel.show(true);
    await commands.executeCommand('workbench.view.files');
    expect([isOpen(), document.activeElement]).toEqual([true, field]);
    sidePanel.dispose();
    await expect(commands.executeCommand('workbench.view.files')).rejects.toThrow(/No command/);
  });

  it("names the key of workbench.view.<id> in the rail button's tooltip, also one bound after the panel was added", () => {
    const { commands, toggle } = setup();
    expect(toggle.title).toBe('Files');
    commands.declareKeybindings([{ key: 'Alt+Digit1', command: 'workbench.view.files' }]);
    toggle.dispatchEvent(new Event('pointerenter'));
    expect(toggle.title).toBe('Files (Alt+1)');
    expect(toggle.getAttribute('aria-label')).toBe('Files');
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
