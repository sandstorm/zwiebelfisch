// @vitest-environment jsdom
// Tests for toolbar.ts, with items defined here. The built-in extensions'
// items are tested together in editor/editor.toolbar.test.ts.
import Bold from '@tiptap/extension-bold';
import { describe, expect, it } from 'vitest';
import { SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';
import { children } from '../../../core/typst-syntax/typst-syntax';
import type { TypstMarkSpec } from '../typst-conversion/typst-conversion';
import { Disposable } from '../../../core/disposable/disposable';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { CommandsHost, type MenuItem } from '../../commands/commands';
import { registerChainButton, svg, VisualEditor, VisualEditorHost, type VisualEditorMenuContext } from '../visual-editor';

const TOOLBAR = 'visualEditor/toolbar';

/**
 * A Visual editor host whose toolbar shows the entries registered with `window` (sorted by `order`, as registered
 * on ties) and runs the commands of `commands`: the window's part, as small as these tests need.
 */
function testHosts() {
  const items: { menuId: string; item: MenuItem<VisualEditorMenuContext> }[] = [];
  const changed = new EventEmitter<string>();
  const commands = new CommandsHost(document.createElement('div'));
  const getMenuItems = (menuId: string, context?: VisualEditorMenuContext) =>
    items.filter((entry) => entry.menuId === menuId && (!entry.item.when || (context !== undefined && entry.item.when(context)))).map((entry) => entry.item).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const window = {
    registerMenuItem(menuId: string, item: MenuItem<VisualEditorMenuContext>) {
      const entry = { menuId, item };
      items.push(entry);
      changed.fire(menuId);
      return new Disposable(() => (items.splice(items.indexOf(entry), 1), changed.fire(menuId)));
    },
    getMenuItems,
  };
  const visualEditor = new VisualEditorHost({
    menus: { getMenuItems, onDidChangeMenu: changed.event, executeCommand: (command, ...args) => commands.executeCommand(command, ...args), keybindingLabel: (command) => commands.keybindingLabel(command) },
  });
  return { visualEditor, commands, window };
}

/** `*x*` as a bold mark, and a "Bold" button for it in a group of its own. */
const STRONG: TypstMarkSpec = {
  name: 'bold',
  tiptap: Bold,
  typst: {
    parseTypst: { syntaxNodes: { Strong: { inline: (p, node, marks) => p.inline(children(node.getChild('Markup')!), p.schema.marks.bold.create().addToSet(marks)) } } },
    toTypst: () => ({ open: '*', close: '*' }),
  },
};
function strong() {
  const hosts = testHosts();
  hosts.visualEditor.registerMark(STRONG);
  registerChainButton(hosts, TOOLBAR, { command: 'test.bold', title: 'Bold', icon: svg(''), group: 'test', chain: (c) => c.toggleBold(), toggled: ({ tiptap }) => tiptap.isActive('bold') });
  // shown only over a selection that is all bold (to test `when`)
  registerChainButton(hosts, TOOLBAR, { command: 'test.unbold', title: 'Unbold', icon: svg(''), group: 'test', chain: (c) => c.unsetBold(), when: ({ tiptap }) => tiptap.isActive('bold') });
  return hosts.visualEditor;
}

function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = new VisualEditor(parent, doc, strong());
  const toolbar = parent.querySelector<HTMLElement>('[role="toolbar"]')!;
  const button = (label: string) => parent.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  return { doc, view, toolbar, button, parent };
}

describe('Visual editor toolbar', () => {
  it("asks a menu's and a floating bar's items for their state only while they show, not after every transaction", () => {
    const asked = { menu: 0, bar: 0 };
    const { visualEditor, window } = testHosts();
    window.registerMenuItem('visualEditor/insert', { command: 'test.counted', title: 'Counted', icon: svg(''), enabled: () => (asked.menu++, true) });
    window.registerMenuItem('visualEditor/selection', { command: 'test.counted', title: 'Counted in bar', icon: svg(''), enabled: () => (asked.bar++, true) });
    const parent = document.body.appendChild(document.createElement('div'));
    const doc = new TypstDocument('Hello world\n');
    const view = new VisualEditor(parent, doc, visualEditor);
    view.reveal(SourceRange.of({ from: 3, to: 3 }));
    doc.setText('Hello there\n', 'elsewhere');
    expect(asked).toEqual({ menu: 0, bar: 0 });
    parent.querySelector<HTMLButtonElement>('button[aria-label="Insert"]')!.click();
    expect(asked.menu).toBe(1);
    view.reveal(SourceRange.of({ from: 3, to: 3 }));
    expect(asked.menu).toBe(2);
    view.reveal(SourceRange.of({ from: 0, to: 5 }));
    expect(asked.bar).toBeGreaterThan(0);
  });

  it('is a labelled toolbar above the editor', () => {
    const { toolbar } = setup('Hello\n');
    expect(toolbar.getAttribute('aria-label')).toBe('Formatting');
    // the text column follows
    expect(toolbar.nextElementSibling?.firstElementChild?.classList.contains('zwf-visual')).toBe(true);
  });

  it("shows a contributed item's state and runs its command", () => {
    const { doc, view, button } = setup('Hello world\n');
    view.reveal(SourceRange.of({ from: 0, to: 'Hello world'.length }));
    button('Bold').click();
    expect(doc.text).toBe('*Hello world*\n');
    expect(button('Bold').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the editor focused: mousedown on a button does not steal focus', () => {
    const { button } = setup('Hello\n');
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button('Bold').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves out a button whose entry's `when` does not hold here", () => {
    const { view, button } = setup('Hello *world*\n');
    view.reveal(SourceRange.of({ from: 0, to: 2 }));
    expect(button('Unbold')).toBeNull();
    view.reveal(SourceRange.of({ from: 8, to: 10 }));
    expect(button('Unbold').hidden).toBe(false);
  });

  it('follows the menus: an entry registered later shows, one disposed goes', () => {
    const { visualEditor, window } = testHosts();
    const parent = document.body.appendChild(document.createElement('div'));
    new VisualEditor(parent, new TypstDocument('Hello\n'), visualEditor);
    const later = window.registerMenuItem(TOOLBAR, { command: 'test.later', title: 'Later', icon: svg('') });
    expect(parent.querySelector('.zwf-toolbar button[aria-label="Later"]')).not.toBeNull();
    later.dispose();
    expect(parent.querySelector('.zwf-toolbar button[aria-label="Later"]')).toBeNull();
  });

  it('shows the short title where an entry has no icon, and its key in the tooltip', () => {
    const { visualEditor, window } = testHosts();
    window.registerMenuItem(TOOLBAR, { command: 'test.wide', title: 'Width 50%', shortTitle: '50%', keybinding: 'Mod+B' });
    const parent = document.body.appendChild(document.createElement('div'));
    new VisualEditor(parent, new TypstDocument('Hello\n'), visualEditor);
    const button = parent.querySelector<HTMLButtonElement>('button[aria-label="Width 50%"]')!;
    expect(button.textContent).toBe('50%');
    expect(button.title).toMatch(/^Width 50% \((Ctrl\+B|⌘B)\)$/);
  });
});

describe('a submenu in a floating bar', () => {
  it("sits among the bar's entries by its order, holds the entries there when it opens, and is left out without any", () => {
    const hosts = testHosts();
    const { visualEditor, window } = hosts;
    visualEditor.registerSubmenu({ id: 'test/words', parent: 'visualEditor/selection', order: 20, label: 'Words', icon: () => svg('') });
    registerChainButton(hosts, 'visualEditor/selection', { command: 'test.first', title: 'First', icon: svg(''), order: 10, chain: (c) => c });
    registerChainButton(hosts, 'visualEditor/selection', { command: 'test.last', title: 'Last', icon: svg(''), order: 30, chain: (c) => c });
    const parent = document.body.appendChild(document.createElement('div'));
    const doc = new TypstDocument('Hello world\n');
    const view = new VisualEditor(parent, doc, visualEditor);
    const bar = parent.querySelector<HTMLElement>('[role="toolbar"][aria-label="Selection"]')!;
    const trigger = bar.querySelector<HTMLButtonElement>('button[aria-label="Words"]')!;
    const labels = [...bar.children].map((child) => (child.matches('button') ? child : child.querySelector('button'))!.getAttribute('aria-label'));
    expect(labels).toEqual(['First', 'Words', 'Last']);
    expect(parent.querySelector('.zwf-toolbar [aria-label="Words"]')).toBeNull(); // not in the row
    view.reveal(SourceRange.of({ from: 0, to: 5 }));
    expect(trigger.parentElement!.hidden).toBe(true);
    registerChainButton(hosts, 'test/words', { command: 'test.hi', title: 'Hi', icon: svg(''), chain: (c) => c.insertContent('Hi') });
    view.reveal(SourceRange.of({ from: 0, to: 4 }));
    expect(trigger.parentElement!.hidden).toBe(false);
    trigger.click();
    bar.querySelector<HTMLButtonElement>('[role="menuitem"][aria-label="Hi"]')!.click();
    expect(doc.text).toBe('Hio world\n');
    expect(window.getMenuItems('test/words').map((item) => item.title)).toEqual(['Hi']);
  });
});
