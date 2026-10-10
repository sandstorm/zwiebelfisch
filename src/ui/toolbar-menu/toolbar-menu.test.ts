// @vitest-environment jsdom
// Tests for toolbar-menu.ts.
import { describe, expect, it, vi } from 'vitest';
import { ToolbarMenu } from './toolbar-menu';

function item(label: string, onClick = () => {}) {
  const button = document.createElement('button');
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}

function setup() {
  const chosen = vi.fn();
  let icon = '<svg>left</svg>';
  const items = [item('Align left', () => chosen('left')), item('Center', () => chosen('center'))];
  const menu = new ToolbarMenu(document, 'Align', () => icon, items);
  document.body.append(menu.element);
  const list = menu.element.querySelector<HTMLElement>('[role="menu"]')!;
  return { menu, list, items, chosen, setIcon: (next: string) => (icon = next) };
}

describe('ToolbarMenu', () => {
  it('opens its labelled items from the trigger; choosing one runs it and closes the menu', () => {
    const { menu, list, items, chosen } = setup();
    expect(list.hidden).toBe(true);
    menu.trigger.click();
    expect([list.hidden, menu.trigger.getAttribute('aria-expanded')]).toEqual([false, 'true']);
    expect(items.map((i) => [i.getAttribute('role'), i.textContent])).toEqual([['menuitem', 'Align left'], ['menuitem', 'Center']]);
    items[1].click();
    expect(chosen).toHaveBeenCalledWith('center');
    expect([list.hidden, menu.trigger.getAttribute('aria-expanded')]).toEqual([true, 'false']);
  });

  it('closes on Escape and on a click elsewhere', () => {
    const { menu, list, items } = setup();
    menu.trigger.click();
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(list.hidden).toBe(true);
    menu.trigger.click();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(list.hidden).toBe(true);
  });

  it('arrow keys move between the enabled items', () => {
    const { menu, items } = setup();
    menu.trigger.click();
    items[0].focus();
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
    items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[0]);
  });

  it('shows the icon given as of the last refresh (e.g. the current alignment)', () => {
    const { menu, setIcon } = setup();
    expect(menu.trigger.innerHTML).toContain('left');
    setIcon('<svg>center</svg>');
    menu.refresh();
    expect(menu.trigger.innerHTML).toContain('center');
  });
});

describe('ToolbarMenu in a shadow root (as in <typst-editor>)', () => {
  it('a press on an item is not "outside": the item gets its click', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const chosen = vi.fn();
    const choice = item('Insert image', chosen);
    const menu = new ToolbarMenu(document, 'Insert', () => '', [choice]);
    root.append(menu.element);
    menu.trigger.click();
    // the document sees the shadow host as the target; the composed path still holds the item
    choice.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    expect(menu.isOpen).toBe(true);
    choice.click();
    expect(chosen).toHaveBeenCalled();
    host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    expect(menu.isOpen).toBe(false);
  });
});
