// @vitest-environment jsdom
// Tests for toolbar.ts, with the host's own items (undo, redo) and an item defined here. The built-in extensions'
// items are tested together in typst-editor/typst-editor.toolbar.test.ts.
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { children, starterKitPart, svg, VisualView, VisualViewContributions, type TypstMarkSpec, type VisualViewContribution } from '../visual-view';

/** `*x*` as a bold mark, and a "Bold" button for it in a group of its own. */
const STRONG: TypstMarkSpec = {
  name: 'bold',
  extension: starterKitPart('testBold', { bold: {} }),
  inlineSyntax: { Strong: (p, node, marks) => p.inline(children(node.getChild('Markup')!), p.schema.marks.bold.create().addToSet(marks)) },
  print: () => ({ open: '*', close: '*' }),
};
const strong: VisualViewContribution = {
  id: 'strong',
  activate: ({ visualView, subscriptions }) => {
    subscriptions.push(
      visualView.registerMark(STRONG),
      visualView.registerToolbarGroup({ kind: 'group', id: 'test', order: 20 }),
      visualView.registerToolbarItem({
        group: 'test',
        action: { label: 'Bold', icon: svg(''), run: (c) => c.toggleBold(), active: (e) => e.isActive('bold') },
      }),
    );
  },
};

function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = new VisualView(parent, doc, VisualViewContributions.from([strong]));
  const toolbar = parent.querySelector<HTMLElement>('[role="toolbar"]')!;
  const button = (label: string) => parent.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  return { doc, view, toolbar, button, parent };
}

describe('Visual view toolbar', () => {
  it('is a labelled toolbar above the editor', () => {
    const { toolbar } = setup('Hello\n');
    expect(toolbar.getAttribute('aria-label')).toBe('Formatting');
    // the text (with the gutters beside it) follows
    expect(toolbar.nextElementSibling?.firstElementChild?.classList.contains('typst-visual')).toBe(true);
  });

  it("shows a contributed item's state and runs its command", () => {
    const { doc, view, button } = setup('Hello world\n');
    view.reveal(0, 'Hello world'.length);
    button('Bold').click();
    expect(doc.text).toBe('*Hello world*\n');
    expect(button('Bold').getAttribute('aria-pressed')).toBe('true');
  });

  it('undo and redo revert and reapply the last edit', () => {
    const { doc, view, button } = setup('Hello world\n');
    expect(button('Undo').disabled).toBe(true);
    view.reveal(0, 'Hello world'.length);
    button('Bold').click();
    expect(button('Undo').disabled).toBe(false);
    button('Undo').click();
    expect(doc.text).toBe('Hello world\n');
    button('Redo').click();
    expect(doc.text).toBe('*Hello world*\n');
  });

  it('keeps the editor focused: mousedown on a button does not steal focus', () => {
    const { button } = setup('Hello\n');
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button('Bold').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
