// @vitest-environment jsdom
// Tests for toolbar.ts, with items defined here. The built-in extensions'
// items are tested together in editor/editor.toolbar.test.ts.
import { describe, expect, it } from 'vitest';
import { SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';
import { children } from '../../../core/typst-syntax/typst-syntax';
import { starterKitPart, type TypstMarkSpec } from '../typst-conversion/typst-conversion';
import { svg, VisualEditor, VisualEditorHost } from '../visual-editor';

/** `*x*` as a bold mark, and a "Bold" button for it in a group of its own. */
const STRONG: TypstMarkSpec = {
  name: 'bold',
  tiptap: starterKitPart('testBold', { bold: {} }),
  typst: {
    parseTypst: { syntaxNodes: { Strong: { inline: (p, node, marks) => p.inline(children(node.getChild('Markup')!), p.schema.marks.bold.create().addToSet(marks)) } } },
    toTypst: () => ({ open: '*', close: '*' }),
  },
};
function strong(): VisualEditorHost {
  const visualEditor = new VisualEditorHost();
  visualEditor.registerMark(STRONG);
  visualEditor.registerToolbarGroup({ kind: 'group', id: 'test', order: 20 });
  visualEditor.registerToolbarItem({
    group: 'test',
    action: { label: 'Bold', icon: svg(''), run: (c) => c.toggleBold(), active: (e) => e.isActive('bold') },
  });
  // shown only over a selection that is all bold (to test `visible`)
  visualEditor.registerToolbarItem({ group: 'test', action: { label: 'Unbold', icon: svg(''), run: (c) => c.unsetBold(), visible: (e) => e.isActive('bold') } });
  return visualEditor;
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
    const counted = new VisualEditorHost();
    counted.registerToolbarItem({ group: 'insert', action: { label: 'Counted', icon: svg(''), enabled: () => (asked.menu++, true) } });
    counted.registerToolbarItem({ group: 'selection', action: { label: 'Counted in bar', icon: svg(''), enabled: () => (asked.bar++, true) } });
    const parent = document.body.appendChild(document.createElement('div'));
    const doc = new TypstDocument('Hello world\n');
    const view = new VisualEditor(parent, doc, counted);
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

  it('leaves out a button whose action is not visible here', () => {
    const { view, button } = setup('Hello *world*\n');
    view.reveal(SourceRange.of({ from: 0, to: 2 }));
    expect(button('Unbold').hidden).toBe(true);
    view.reveal(SourceRange.of({ from: 8, to: 10 }));
    expect(button('Unbold').hidden).toBe(false);
  });
});

describe('a menu in a floating bar', () => {
  it("sits among the bar's items by its order, holds the actions provided when it opens, and is left out without any", () => {
    let words: string[] = [];
    const menus = new VisualEditorHost();
    menus.registerToolbarGroup({ kind: 'menu', id: 'words', bar: 'selection', order: 20, label: 'Words', icon: () => svg('') });
    menus.registerToolbarItem({ group: 'words', provideActions: () => words.map((word) => ({ label: word, icon: svg(''), run: (c) => c.insertContent(word) })) });
    menus.registerToolbarItem({ group: 'selection', order: 10, action: { label: 'First', icon: svg(''), run: (c) => c } });
    menus.registerToolbarItem({ group: 'selection', order: 30, action: { label: 'Last', icon: svg(''), run: (c) => c } });
    const parent = document.body.appendChild(document.createElement('div'));
    const doc = new TypstDocument('Hello world\n');
    const view = new VisualEditor(parent, doc, menus);
    const bar = parent.querySelector<HTMLElement>('[role="toolbar"][aria-label="Selection"]')!;
    const trigger = bar.querySelector<HTMLButtonElement>('button[aria-label="Words"]')!;
    const labels = [...bar.children].map((child) => (child.matches('button') ? child : child.querySelector('button'))!.getAttribute('aria-label'));
    expect(labels).toEqual(['First', 'Words', 'Last']);
    expect(parent.querySelector('.zwf-toolbar [aria-label="Words"]')).toBeNull(); // not in the row
    view.reveal(SourceRange.of({ from: 0, to: 5 }));
    expect(trigger.parentElement!.hidden).toBe(true);
    words = ['Hi'];
    view.reveal(SourceRange.of({ from: 0, to: 4 }));
    expect(trigger.parentElement!.hidden).toBe(false);
    trigger.click();
    bar.querySelector<HTMLButtonElement>('[role="menuitem"][aria-label="Hi"]')!.click();
    expect(doc.text).toBe('Hio world\n');
  });
});
