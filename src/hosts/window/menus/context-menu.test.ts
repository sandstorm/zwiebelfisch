// @vitest-environment jsdom
// Tests for context-menu.ts, over menus of its own and commands faked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandsHost, MenuContext, MenuItem } from '../../commands/commands';
import { ContextMenu } from './context-menu';
import { Menus } from './menus';

afterEach(() => document.body.replaceChildren());

/** The menu `explorer/context` as an extension might fill it: entries only for folders, one for anything. */
const ENTRIES: MenuItem[] = [
  { command: 'files.rename', title: 'Rename…', group: 'edit' },
  { command: 'files.delete', title: 'Delete', group: 'edit' },
  { command: 'files.newFile', group: 'new', when: (context) => context.resourceKind === 'folder' },
];

/** Menus holding `items` under `menuId`. */
function menusWith(menuId: string, items: readonly MenuItem[]): Menus {
  const menus = new Menus();
  for (const item of items) menus.register(menuId, item);
  return menus;
}

/** Commands that run nothing and have no keys, else as `more` says. */
function commandsWith(more: { executeCommand?(command: string, ...args: unknown[]): Promise<unknown>; keybindingLabel?(command: string): string | undefined } = {}) {
  return { executeCommand: async () => undefined, keybindingLabel: () => undefined, ...more } as Pick<CommandsHost, 'executeCommand' | 'keybindingLabel'>;
}

function setup() {
  const host = document.body.appendChild(document.createElement('div'));
  const trigger = host.appendChild(document.createElement('button'));
  trigger.focus();
  const ran: unknown[][] = [];
  const menus = new ContextMenu(
    host,
    menusWith('explorer/context', ENTRIES),
    commandsWith({ executeCommand: async (command, ...args) => void ran.push([command, document.activeElement === trigger, ...args]), keybindingLabel: (command) => (command === 'files.delete' ? '⌫' : undefined) }),
  );
  const show = (resourceKind = 'folder') => menus.show('explorer/context', { anchor: { x: 10, y: 20 }, title: 'chapters', context: { resourceKind }, args: ['/chapters'] });
  const items = () => [...host.querySelectorAll<HTMLElement>('.zwf-context-menu__item')];
  const key = (key: string) => (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const isOpen = () => host.querySelector('[role=menu]') !== null;
  return { host, trigger, menus, show, ran, items, key, isOpen };
}

describe('ContextMenu', () => {
  it("lists the menu's entries for the context, a separator between groups, and focuses the first", () => {
    const { host, show, items } = setup();
    show();
    const menu = host.querySelector('[role=menu]')!;
    expect(menu.getAttribute('aria-label')).toBe('chapters');
    expect([...menu.children].map((child) => child.getAttribute('role'))).toEqual(['menuitem', 'menuitem', 'separator', 'menuitem']);
    expect(items().map((item) => item.textContent)).toEqual(['Rename…', 'Delete ⌫', 'files.newFile']);
    expect(document.activeElement).toBe(items()[0]);
  });

  it('shows an entry with `toggled` as a checkbox, checked as it says in the context, the others aligned with it', () => {
    const host = document.body.appendChild(document.createElement('div'));
    const shown: MenuContext[] = [];
    const items: MenuItem[] = [
      { command: 'x.wrap', title: 'Wrap', toggled: (context) => (shown.push(context), context.wrap === true) },
      { command: 'x.guides', title: 'Guides', toggled: () => false },
      { command: 'x.reset', title: 'Reset', group: 'z' },
    ];
    const menus = new ContextMenu(host, menusWith('view', items), commandsWith());
    menus.show('view', { anchor: host, title: 'View', context: { wrap: true } });
    const entries = [...host.querySelectorAll<HTMLElement>('.zwf-context-menu__item')];
    expect(entries.map((entry) => [entry.getAttribute('role'), entry.getAttribute('aria-checked'), entry.textContent])).toEqual([
      ['menuitemcheckbox', 'true', '✓Wrap'],
      ['menuitemcheckbox', 'false', 'Guides'],
      ['menuitem', null, 'Reset'],
    ]);
    expect(shown).toEqual([{ wrap: true }]);
    expect(host.querySelector('[role=menu]')!.classList.contains('zwf-context-menu--checks')).toBe(true);
  });

  it('moves with the arrow keys, Home and End', () => {
    const { show, items, key } = setup();
    show();
    key('ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    key('End');
    expect(document.activeElement).toBe(items()[2]);
    key('ArrowDown');
    expect(document.activeElement).toBe(items()[0]);
    key('ArrowUp');
    expect(document.activeElement).toBe(items()[2]);
  });

  it("runs a chosen entry's command with the menu's arguments after closing, the focus back on the trigger", () => {
    const { show, items, ran, isOpen } = setup();
    show('file');
    items()[1].click();
    expect(ran).toEqual([['files.delete', true, '/chapters']]);
    expect(isOpen()).toBe(false);
  });

  it('logs a failing command', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const menus = new ContextMenu(host, menusWith('m', [{ command: 'x.fail' }]), commandsWith({ executeCommand: async () => Promise.reject(new Error('no')) }));
    menus.show('m', { anchor: host, title: 'm' });
    host.querySelector<HTMLElement>('[role=menuitem]')!.click();
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Command x.fail failed:', expect.any(Error)));
    error.mockRestore();
  });

  it('shows nothing for a menu without entries that apply', () => {
    const { menus, isOpen } = setup();
    menus.show('file/newFile', { anchor: { x: 0, y: 0 }, title: 'New' });
    expect(isOpen()).toBe(false);
  });

  it('closes on Escape, on a press elsewhere, on a new menu and on dispose', () => {
    const { host, show, menus, trigger, ran, isOpen, key } = setup();
    show();
    key('Escape');
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(trigger);
    show();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(isOpen()).toBe(false);
    show();
    show('file');
    expect(host.querySelectorAll('[role=menu]')).toHaveLength(1);
    menus.dispose();
    expect(isOpen()).toBe(false);
    expect(ran).toEqual([]);
  });
});
