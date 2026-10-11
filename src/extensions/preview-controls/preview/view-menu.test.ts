// @vitest-environment jsdom
// Tests for view-menu.ts.
import { afterEach, describe, expect, it } from 'vitest';
import type { PreviewContext, PreviewViewOption } from '../../../hosts/preview/preview';
import type { Memento } from '../../../hosts/workbench/workbench';
import { viewMenu } from './view-menu';

describe('viewMenu', () => {
  afterEach(() => document.body.replaceChildren());

  function setup(saved: Record<string, unknown> = {}) {
    const stored = new Map<string, unknown>(Object.entries(saved));
    const state = { keys: () => [...stored.keys()], get: (key: string) => stored.get(key), update: async (key: string, value: unknown) => void stored.set(key, value) } as Memento;
    const options: PreviewViewOption[] = [];
    const values: Record<string, boolean>[] = [];
    const preview = { viewOptions: () => options, setViewOptionValues: (each: Record<string, boolean>) => void values.push({ ...each }) };
    const item = viewMenu(preview, state)({ ownerDocument: document } as PreviewContext);
    document.body.append(...item.elements);
    const menu = item.elements[0];
    const button = menu.querySelector('button')!;
    const boxes = () => [...menu.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].map((input) => [input.parentElement!.textContent, input.checked]);
    return { item, menu, button, boxes, options, values, stored };
  }
  const option = (id: string, label: string, on = false): PreviewViewOption => ({ id, label, default: on, apply: (entry) => entry });

  it('is hidden until a view option is registered', () => {
    const { item, menu, options } = setup();
    expect(menu.hidden).toBe(true);
    options.push(option('a.guides', 'Page guides'));
    item.update!();
    expect(menu.hidden).toBe(false);
  });

  it('hands the remembered values to the preview at once, also of options not registered yet', () => {
    const { values } = setup({ viewOptions: { 'a.guides': true, 'b.junk': 'yes' } });
    expect(values).toEqual([{ 'a.guides': true }]);
  });

  it('shows a checkbox per option, as remembered or by default; a change applies at once and is remembered', () => {
    const { menu, button, boxes, options, values, stored } = setup({ viewOptions: { 'a.guides': true } });
    options.push(option('a.guides', 'Page guides'), option('b.outlines', 'Box outlines'));
    button.click();
    expect(boxes()).toEqual([
      ['Page guides', true],
      ['Box outlines', false],
    ]);
    const outlines = [...menu.querySelectorAll<HTMLInputElement>('input')].at(-1)!;
    outlines.click();
    expect(values.at(-1)).toEqual({ 'a.guides': true, 'b.outlines': true });
    expect(stored.get('viewOptions')).toEqual({ 'a.guides': true, 'b.outlines': true });
    button.click();
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
});
