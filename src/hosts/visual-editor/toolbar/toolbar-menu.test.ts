// @vitest-environment jsdom
// Tests for ToolbarMenu (toolbar-menu.ts).
import { describe, expect, it, vi } from 'vitest';
import { ToolbarMenu, type MenuContent, type MenuItems } from './toolbar-menu';

function item(label: string, onClick = () => {}) {
  const button = document.createElement('button');
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}

/** A menu with icon `icon()` holding `buttons()` as of when it opens (the same items while that is the same array). */
function content(icon: () => string, buttons: () => HTMLButtonElement[]): MenuContent {
  let items: MenuItems = { buttons: [], refresh: () => {} };
  return {
    icon,
    hasItems: () => buttons().length > 0,
    items: () => (items.buttons === buttons() ? items : (items = { buttons: buttons(), refresh: () => {} })),
  };
}

/** The menu's trigger, as the toolbar row shows it. */
const trigger = (menu: ToolbarMenu) => menu.element.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;

function setup() {
  const chosen = vi.fn();
  let icon = '<svg>left</svg>';
  const items = [item('Align left', () => chosen('left')), item('Center', () => chosen('center'))];
  const menu = new ToolbarMenu(document, 'Align', content(() => icon, () => items));
  document.body.append(menu.element);
  const list = menu.element.querySelector<HTMLElement>('[role="menu"]')!;
  return { menu, trigger: trigger(menu), list, items, chosen, setIcon: (next: string) => (icon = next) };
}

describe('ToolbarMenu', () => {
  it('opens its labelled items from the trigger; choosing one runs it and closes the menu', () => {
    const { trigger, list, items, chosen } = setup();
    expect(list.hidden).toBe(true);
    trigger.click();
    expect([list.hidden, trigger.getAttribute('aria-expanded')]).toEqual([false, 'true']);
    expect(items.map((i) => [i.getAttribute('role'), i.textContent])).toEqual([['menuitem', 'Align left'], ['menuitem', 'Center']]);
    items[1].click();
    expect(chosen).toHaveBeenCalledWith('center');
    expect([list.hidden, trigger.getAttribute('aria-expanded')]).toEqual([true, 'false']);
  });

  it('closes on Escape and on a click elsewhere', () => {
    const { trigger, list, items } = setup();
    trigger.click();
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(list.hidden).toBe(true);
    trigger.click();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(list.hidden).toBe(true);
  });

  it('arrow keys move between the enabled items', () => {
    const { trigger, items } = setup();
    trigger.click();
    items[0].focus();
    items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[1]);
    items[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(items[0]);
  });

  it('holds the items as of when it opens, and hides while it has none', () => {
    let labels: string[] = [];
    const menu = new ToolbarMenu(document, 'Styles', content(() => '', () => labels.map((label) => item(label))));
    document.body.append(menu.element);
    expect(menu.element.hidden).toBe(true);
    labels = ['Key'];
    menu.refresh();
    expect(menu.element.hidden).toBe(false);
    trigger(menu).click();
    labels = ['Key', 'Term'];
    trigger(menu).click();
    trigger(menu).click();
    expect([...menu.element.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent)).toEqual(['Key', 'Term']);
  });

  it('a list taller than the room its clipping ancestor leaves below the trigger scrolls', () => {
    const editor = document.createElement('div');
    editor.style.overflow = 'hidden';
    document.body.append(editor);
    const items = Array.from({ length: 13 }, (_, i) => item(`Item ${i}`));
    const menu = new ToolbarMenu(document, 'Insert', content(() => '', () => items));
    editor.append(menu.element);
    const list = menu.element.querySelector<HTMLElement>('[role="menu"]')!;
    // jsdom lays nothing out: the editor ends at 300px, the list starts at 100px and is 390px tall
    vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 300));
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 190, 390));
    vi.spyOn(list, 'scrollHeight', 'get').mockReturnValue(390);
    trigger(menu).click();
    expect(list.style.maxHeight).toBe('192px');
    trigger(menu).click();
    vi.spyOn(list, 'scrollHeight', 'get').mockReturnValue(150);
    trigger(menu).click();
    expect(list.style.maxHeight).toBe('');
  });

  it('shows the icon given as of the last refresh (e.g. the current alignment)', () => {
    const { menu, trigger, setIcon } = setup();
    expect(trigger.innerHTML).toContain('left');
    setIcon('<svg>center</svg>');
    menu.refresh();
    expect(trigger.innerHTML).toContain('center');
  });
});

describe('ToolbarMenu in a shadow root (as in <typst-editor>)', () => {
  it('a press on an item is not "outside": the item gets its click', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    const chosen = vi.fn();
    const choice = item('Insert image', chosen);
    const menu = new ToolbarMenu(document, 'Insert', content(() => '', () => [choice]));
    root.append(menu.element);
    trigger(menu).click();
    // the document sees the shadow host as the target; the composed path still holds the item
    choice.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    expect(trigger(menu).getAttribute('aria-expanded')).toBe('true');
    choice.click();
    expect(chosen).toHaveBeenCalled();
    host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
    expect(trigger(menu).getAttribute('aria-expanded')).toBe('false');
  });
});
