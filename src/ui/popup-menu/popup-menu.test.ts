// @vitest-environment jsdom
// Tests for popup-menu.ts.
import { afterEach, describe, expect, it } from 'vitest';
import { PopupMenu } from './popup-menu';

afterEach(() => document.body.replaceChildren());

function setup() {
  const container = document.body.appendChild(document.createElement('div'));
  const trigger = container.appendChild(document.createElement('button'));
  trigger.focus();
  const ran: string[] = [];
  const entry = (label: string, group?: string) => ({ label, group, run: () => ran.push(`${label}:${document.activeElement === trigger}`) });
  const menu = new PopupMenu(container, 'File', [entry('Rename…', 'edit'), entry('Delete', 'edit'), entry('New file…', 'new')], { x: 10, y: 20 });
  const items = () => [...container.querySelectorAll<HTMLElement>('[role=menuitem]')];
  const key = (key: string) => (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const isOpen = () => container.querySelector('[role=menu]') !== null;
  return { container, trigger, menu, ran, items, key, isOpen };
}

describe('PopupMenu', () => {
  it('lists the entries with a separator between groups and focuses the first', () => {
    const { container, items } = setup();
    const menu = container.querySelector('[role=menu]')!;
    expect(menu.getAttribute('aria-label')).toBe('File');
    expect([...menu.children].map((child) => child.getAttribute('role'))).toEqual(['menuitem', 'menuitem', 'separator', 'menuitem']);
    expect(document.activeElement).toBe(items()[0]);
  });

  it('moves with the arrow keys, Home and End', () => {
    const { items, key } = setup();
    key('ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    key('End');
    expect(document.activeElement).toBe(items()[2]);
    key('ArrowDown');
    expect(document.activeElement).toBe(items()[0]);
    key('ArrowUp');
    expect(document.activeElement).toBe(items()[2]);
  });

  it('runs a chosen entry after closing, with the focus back on the trigger', () => {
    const { items, ran, isOpen } = setup();
    items()[1].click();
    expect(ran).toEqual(['Delete:true']);
    expect(isOpen()).toBe(false);
    expect(items()).toHaveLength(0);
  });

  it('closes on Escape and on a press elsewhere', () => {
    const first = setup();
    first.key('Escape');
    expect(first.isOpen()).toBe(false);
    expect(document.activeElement).toBe(first.trigger);
    const second = setup();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(second.isOpen()).toBe(false);
    expect(second.ran).toEqual([]);
  });
});
