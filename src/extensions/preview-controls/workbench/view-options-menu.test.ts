// Tests for view-options-menu.ts, with the preview, the menus and the commands faked.
import { describe, expect, it } from 'vitest';
import { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import type { PreviewViewOption } from '../../../hosts/preview/preview';
import type { MenuItem } from '../../../hosts/commands/commands';
import type { Memento } from '../../../hosts/workbench/workbench';
import { registerViewOptionsMenu } from './view-options-menu';

function setup(saved: Record<string, unknown> = {}) {
  const stored = new Map<string, unknown>(Object.entries(saved));
  const state = { get: (key: string) => stored.get(key), update: async (key: string, value: unknown) => void stored.set(key, value) } as Memento;
  const options: PreviewViewOption[] = [];
  const changed = new EventEmitter<void>();
  const values: Record<string, boolean>[] = [];
  const items: [string, MenuItem][] = [];
  const handlers = new Map<string, () => unknown>();
  const registration = registerViewOptionsMenu({
    preview: { viewOptions: () => options, setViewOptionValues: (each) => void values.push({ ...each }), onDidChangeViewOptions: changed.event },
    workbench: {
      registerMenuItem: (menuId, item) => {
        const entry: [string, MenuItem] = [menuId, item as MenuItem];
        items.push(entry);
        return new Disposable(() => items.splice(items.indexOf(entry), 1));
      },
    },
    commands: {
      registerCommand: (id, handler) => {
        handlers.set(id, handler);
        return new Disposable(() => handlers.delete(id));
      },
    },
    state,
  });
  const register = (...added: PreviewViewOption[]) => {
    options.push(...added);
    changed.fire();
  };
  /** The View menu's entries: title, group, checked. */
  const menu = () => items.map(([menuId, item]) => [menuId, item.title, item.group, item.toggled?.({})]);
  const choose = (title: string) => handlers.get(items.find(([, item]) => item.title === title)![1].command)!();
  return { registration, register, menu, choose, values, stored, handlers, items };
}

const option = (id: string, label: string, on = false): PreviewViewOption => ({ id, label, default: on, apply: (entry) => entry });

describe('registerViewOptionsMenu', () => {
  it('hands the remembered values to the preview at once, also of options not registered yet', () => {
    const { values } = setup({ viewOptions: { 'a.guides': true, 'b.junk': 'yes' } });
    expect(values).toEqual([{ 'a.guides': true }]);
  });

  it('lists every view option in the View menu (group preview), checked as remembered or by default, following registrations', () => {
    const { register, menu, registration, items } = setup({ viewOptions: { 'a.guides': true } });
    expect(menu()).toEqual([]);
    register(option('a.guides', 'Page guides'), option('b.outlines', 'Box outlines'));
    register(option('c.comments', 'Comments', true));
    expect(menu()).toEqual([
      ['view', 'Page guides', 'preview', true],
      ['view', 'Box outlines', 'preview', false],
      ['view', 'Comments', 'preview', true],
    ]);
    expect(items.map(([, item]) => item.order)).toEqual([0, 1, 2]);
    registration.dispose();
    expect(menu()).toEqual([]);
  });

  it('turns an option over when chosen, at once and remembered', () => {
    const { register, menu, choose, values, stored, handlers } = setup({ viewOptions: { 'a.guides': true } });
    register(option('a.guides', 'Page guides'), option('c.comments', 'Comments', true));
    expect([...handlers.keys()]).toEqual(['previewControls.toggleViewOption.a.guides', 'previewControls.toggleViewOption.c.comments']);
    choose('Comments');
    expect(values.at(-1)).toEqual({ 'a.guides': true, 'c.comments': false });
    expect(stored.get('viewOptions')).toEqual({ 'a.guides': true, 'c.comments': false });
    choose('Page guides');
    expect(values.at(-1)).toEqual({ 'a.guides': false, 'c.comments': false });
    expect(menu().map((entry) => entry[3])).toEqual([false, false]);
  });
});
