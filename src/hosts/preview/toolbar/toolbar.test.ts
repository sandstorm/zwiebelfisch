// @vitest-environment jsdom
// Tests for toolbar.ts: the preview's toolbar over faked menus.
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import type { MenuItem } from '../../commands/commands';
import type { PreviewMenuContext } from '../preview';
import { PreviewToolbar } from './toolbar';

function setup(items: MenuItem<PreviewMenuContext>[]) {
  const menuChanged = new EventEmitter<string>();
  const configurationChanged = new EventEmitter<unknown>();
  let finish: () => void = () => {};
  const executeCommand = vi.fn((_command: string, ..._args: unknown[]) => new Promise<unknown>((resolve) => (finish = () => resolve(undefined))));
  const element = document.createElement('div');
  const context: PreviewMenuContext = { previewRenderer: 'pages' };
  const toolbar = new PreviewToolbar(
    element,
    {
      getMenuItems: (_menuId, given) => items.filter((item) => item.when?.(given) ?? true),
      onDidChangeMenu: menuChanged.event,
      onDidChangeConfiguration: configurationChanged.event,
      executeCommand,
      keybindingLabel: (command) => (command === 'test.zoomIn' ? '⌘+' : undefined),
    },
    () => context,
  );
  const buttons = () => [...element.querySelectorAll('button')];
  const button = (label: string) => buttons().find((each) => each.getAttribute('aria-label') === label)!;
  return { toolbar, element, buttons, button, menuChanged, configurationChanged, executeCommand, finish: () => finish() };
}

describe('PreviewToolbar', () => {
  it('shows a button per entry, a group per entry group: its icon, else short title, else title; title and key as tooltip', () => {
    const { element, button } = setup([
      { command: 'test.follow', title: 'Follow cursor', group: '1_sync' },
      { command: 'test.zoomIn', title: 'Zoom in', shortTitle: '+', group: '2_zoom' },
      { command: 'test.icon', title: 'Iconic', icon: '<svg></svg>', group: '2_zoom' },
    ]);
    expect([...element.children].map((group) => group.childElementCount)).toEqual([1, 2]);
    expect(button('Follow cursor').textContent).toBe('Follow cursor');
    expect([button('Zoom in').textContent, button('Zoom in').title, button('Zoom in').dataset.command]).toEqual(['+', 'Zoom in (⌘+)', 'test.zoomIn']);
    expect(button('Iconic').querySelector('svg')).not.toBeNull();
  });

  it('runs the command with the context; shows the state again once it settled', async () => {
    let on = false;
    let busy = false;
    const { button, executeCommand, finish } = setup([
      { command: 'test.follow', title: 'Follow', toggled: () => on },
      { command: 'test.pdf', title: 'PDF', enabled: () => !busy },
    ]);
    expect(button('Follow').getAttribute('aria-pressed')).toBe('false');
    expect(button('PDF').hasAttribute('aria-pressed')).toBe(false);
    on = true;
    busy = true;
    button('Follow').click();
    expect(executeCommand).toHaveBeenCalledWith('test.follow', { previewRenderer: 'pages' });
    expect(button('Follow').getAttribute('aria-pressed')).toBe('true');
    expect(button('PDF').disabled).toBe(true);
    busy = false;
    finish();
    await vi.waitFor(() => expect(button('PDF').disabled).toBe(false));
  });

  it('follows the menu and the settings, keeping the buttons it made', async () => {
    const items: MenuItem<PreviewMenuContext>[] = [{ command: 'test.a', title: 'A' }];
    let shown = true;
    const { buttons, button, menuChanged, configurationChanged, toolbar, element } = setup(items);
    const a = button('A');
    items.push({ command: 'test.b', title: 'B', when: () => shown });
    menuChanged.fire('window/view');
    expect(buttons()).toHaveLength(1);
    menuChanged.fire('preview/toolbar');
    expect(buttons().map((each) => each.textContent)).toEqual(['A', 'B']);
    expect(button('A')).toBe(a);
    shown = false;
    configurationChanged.fire({});
    await Promise.resolve();
    expect(buttons().map((each) => each.textContent)).toEqual(['A']);
    toolbar.dispose();
    expect(element.childElementCount).toBe(0);
  });
});
