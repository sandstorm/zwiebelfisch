// @vitest-environment jsdom
// Tests for TextStyleMenu (text-style-menu.ts), through the Visual editor, with entries and a mark defined here.
import Bold from '@tiptap/extension-bold';
import { describe, expect, it, vi } from 'vitest';
import { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';
import { children } from '../../../core/typst-syntax/typst-syntax';
import { CommandsHost, type MenuItem } from '../../commands/commands';
import type { TypstMarkSpec } from '../typst-conversion/typst-conversion';
import { registerChainButton, VisualEditor, VisualEditorHost, type ChainButton, type VisualEditorMenuContext } from '../visual-editor';

// jsdom lacks layout; ProseMirror only needs these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

/** `*x*` as a bold mark. */
const STRONG: TypstMarkSpec = {
  name: 'bold',
  tiptap: Bold,
  typst: {
    parseTypst: { syntaxNodes: { Strong: { inline: (p, node, marks) => p.inline(children(node.getChild('Markup')!), p.schema.marks.bold.create().addToSet(marks)) } } },
    toTypst: () => ({ open: '*', close: '*' }),
  },
};

/** A toggle on the selection's text. */
const BOLD: ChainButton = { command: 'test.bold', title: 'Bold', category: 'Text styles', group: 'inline', order: 20, chain: (c) => c.toggleBold(), toggled: ({ tiptap }) => tiptap.isActive('bold') };

/** A block style (here: a paragraph all in bold), taken off when chosen where it is on (as Normal text does). */
const LOUD: ChainButton = {
  command: 'test.loud',
  title: 'Loud',
  order: 10,
  chain: (c) => c.command(({ editor, commands }) => (editor.isActive('bold') ? commands.selectParentNode() && commands.unsetBold() : commands.setBold())),
  toggled: ({ tiptap }) => tiptap.isActive('bold'),
};

const TEXT_STYLE = 'visualEditor/textStyle';

/** The window's menus and commands, as small as these tests need: entries by group (`inline` after ''), then `order`. */
function testHosts() {
  const items: { menuId: string; item: MenuItem<VisualEditorMenuContext> }[] = [];
  const changed = new EventEmitter<string>();
  const commands = new CommandsHost(document.createElement('div'));
  const rank = (item: MenuItem<VisualEditorMenuContext>) => item.group ?? '';
  const getMenuItems = (menuId: string) =>
    items
      .filter((entry) => entry.menuId === menuId)
      .map((entry) => entry.item)
      .sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0) || (a.order ?? 0) - (b.order ?? 0));
  const window = {
    registerMenuItem(menuId: string, item: MenuItem<VisualEditorMenuContext>) {
      const entry = { menuId, item };
      items.push(entry);
      changed.fire(menuId);
      return new Disposable(() => (items.splice(items.indexOf(entry), 1), changed.fire(menuId)));
    },
  };
  const visualEditor = new VisualEditorHost({
    menus: { getMenuItems, onDidChangeMenu: changed.event, executeCommand: (command, ...args) => commands.executeCommand(command, ...args), keybindingLabel: () => undefined },
  });
  return { visualEditor, commands, window };
}

function setup(text: string, entries: readonly ChainButton[]) {
  const parent = document.body.appendChild(document.createElement('div'));
  const doc = new TypstDocument(text);
  const hosts = testHosts();
  hosts.visualEditor.registerMark(STRONG);
  for (const entry of entries) registerChainButton(hosts, TEXT_STYLE, entry);
  const view = new VisualEditor(parent, doc, hosts.visualEditor);
  const menu = () => parent.querySelector<HTMLSelectElement>('select[aria-label="Text style"]');
  const choose = (value: string) => {
    menu()!.value = value;
    menu()!.dispatchEvent(new Event('change', { bubbles: true }));
  };
  /** The option `value` as the opened list shows it (the options are looked at when the menu is pressed). */
  const option = (value: string) => {
    menu()!.dispatchEvent(new MouseEvent('mousedown'));
    return [...menu()!.options].find((o) => o.value === value)!;
  };
  return { doc, view, menu, choose, option, hosts };
}

describe('the text style menu', () => {
  it('looks at its options when pressed, not after every transaction', () => {
    const enabled = vi.fn(() => true);
    const { view, menu, hosts } = setup('Hello world\n', []);
    hosts.window.registerMenuItem(TEXT_STYLE, { command: 'test.counted', title: 'Counted', enabled });
    view.reveal(SourceRange.of({ from: 0, to: 5 }));
    expect(enabled).not.toHaveBeenCalled();
    menu()!.dispatchEvent(new MouseEvent('mousedown'));
    expect(enabled).toHaveBeenCalledTimes(1);
  });

  it('shows only while its menu has entries', () => {
    expect(setup('Text\n', []).menu()).toBeNull();
    expect(setup('Text\n', [LOUD]).menu()).not.toBeNull();
  });

  it('lists Normal text first, then the entries as sorted, a category under its title', () => {
    const { menu } = setup('Text\n', [BOLD, LOUD]);
    expect([...menu()!.children].map((c) => (c instanceof HTMLOptGroupElement ? [c.label, ...[...c.children].map((o) => o.textContent)] : c.textContent))).toEqual([
      'Normal text',
      'Loud',
      ['Text styles', 'Bold'],
    ]);
  });

  it('follows its menu as entries are registered', () => {
    const { menu, hosts, view } = setup('Text\n', [BOLD]);
    expect(menu()!.options.length).toBe(2);
    registerChainButton(hosts, TEXT_STYLE, LOUD);
    view.reveal(SourceRange.of({ from: 1, to: 1 }));
    expect([...menu()!.options].map((o) => o.value)).toEqual(['paragraph', 'test.loud', 'test.bold']);
  });

  it('runs a toggle on the selection, marks it ✓ where on, and never shows it as its value', () => {
    const { doc, view, menu, choose, option } = setup('Hello world\n', [BOLD]);
    view.reveal(SourceRange.of({ from: 0, to: 'Hello'.length }));
    choose('test.bold');
    expect(doc.text).toBe('*Hello* world\n');
    expect(option('test.bold').text).toBe('✓ Bold');
    expect(menu()!.value).toBe('paragraph');
  });

  it("shows the selection's block style, and Normal text takes it off", () => {
    const { doc, view, menu, choose, option } = setup('*Hello*\n', [LOUD]);
    view.reveal(SourceRange.of({ from: 1, to: 3 }));
    expect(menu()!.value).toBe('test.loud');
    // the blocks are paragraphs already: taking the style off is all Normal text does
    expect(option('paragraph').disabled).toBe(false);
    choose('paragraph');
    expect(doc.text).toBe('Hello\n');
    expect(menu()!.value).toBe('paragraph');
  });

  it('disables an entry that cannot apply', () => {
    const { option } = setup('Text\n', [{ ...LOUD, chain: (c) => c.command(() => false) }]);
    expect(option('test.loud').disabled).toBe(true);
  });
});
