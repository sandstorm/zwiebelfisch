// @vitest-environment jsdom
// Tests for TextStyleMenu (text-style-menu.ts), through the Visual editor, with providers and a mark defined here.
import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import { SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';
import { children } from '../../../core/typst-syntax/typst-syntax';
import { starterKitPart, type TypstMarkSpec } from '../../prosemirror-typst/prosemirror-typst';
import { VisualEditor, VisualEditorHost, type TextStyle, type TextStyleProvider } from '../visual-editor';

// jsdom lacks layout; ProseMirror only needs these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

/** `*x*` as a bold mark. */
const STRONG: TypstMarkSpec = {
  name: 'bold',
  tiptap: starterKitPart('testBold', { bold: {} }),
  typst: {
    parseTypst: { syntaxNodes: { Strong: { inline: (p, node, marks) => p.inline(children(node.getChild('Markup')!), p.schema.marks.bold.create().addToSet(marks)) } } },
    toTypst: () => ({ open: '*', close: '*' }),
  },
};

/** A toggle on the selection's text. */
const BOLD: TextStyle = { id: 'bold', label: 'Bold', section: 'Text styles', order: 20, toggle: true, apply: (c) => c.toggleBold(), isActive: (e) => e.isActive('bold') };

/** A block style (here: a paragraph all in bold) that Normal text takes off. */
const LOUD: TextStyle = { id: 'loud', label: 'Loud', order: 10, apply: (c) => c.setBold(), isActive: (e) => e.isActive('bold'), remove: (c) => c.selectParentNode().unsetBold() };

function setup(text: string, providers: readonly TextStyleProvider[]) {
  const parent = document.body.appendChild(document.createElement('div'));
  const doc = new TypstDocument(text);
  const view = new VisualEditor(
    parent,
    doc,
    VisualEditorHost.from([
      {
        id: 'test',
        activate: ({ visualEditor, subscriptions }) => subscriptions.push(visualEditor.registerMark(STRONG), ...providers.map((p) => visualEditor.registerTextStyleProvider(p))),
      },
    ]),
  );
  const menu = parent.querySelector<HTMLSelectElement>('select[aria-label="Text style"]');
  const choose = (value: string) => {
    menu!.value = value;
    menu!.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const option = (value: string) => [...menu!.options].find((o) => o.value === value)!;
  return { doc, view, menu, choose, option };
}

describe('the text style menu', () => {
  it('shows only when a provider contributes to it', () => {
    expect(setup('Text\n', []).menu).toBeNull();
    expect(setup('Text\n', [{ provideTextStyles: () => [] }]).menu).not.toBeNull();
  });

  it('lists Normal text first, then the entries by order, a section under its title', () => {
    const { menu } = setup('Text\n', [{ provideTextStyles: () => [BOLD] }, { provideTextStyles: () => [LOUD] }]);
    expect([...menu!.children].map((c) => (c instanceof HTMLOptGroupElement ? [c.label, ...[...c.children].map((o) => o.textContent)] : c.textContent))).toEqual([
      'Normal text',
      'Loud',
      ['Text styles', 'Bold'],
    ]);
  });

  it('asks a provider again when it reports a change', () => {
    const changed = new EventEmitter<void>();
    let entries: TextStyle[] = [];
    const { menu } = setup('Text\n', [{ provideTextStyles: () => entries, onDidChangeTextStyles: changed.event }]);
    expect(menu!.options.length).toBe(1);
    entries = [LOUD];
    changed.fire();
    expect([...menu!.options].map((o) => o.value)).toEqual(['paragraph', 'loud']);
  });

  it('applies a toggle on the selection, marks it ✓ where on, and tells the entry', () => {
    const applied = vi.fn();
    const { doc, view, menu, choose, option } = setup('Hello world\n', [{ provideTextStyles: () => [{ ...BOLD, applied }] }]);
    view.reveal(SourceRange.of({ from: 0, to: 'Hello'.length }));
    choose('bold');
    expect(doc.text).toBe('*Hello* world\n');
    expect(applied).toHaveBeenCalled();
    expect(option('bold').text).toBe('✓ Bold');
    // a toggle is never the menu's value
    expect(menu!.value).toBe('paragraph');
  });

  it("shows the selection's block style, and Normal text takes it off", () => {
    const { doc, view, menu, choose, option } = setup('*Hello*\n', [{ provideTextStyles: () => [LOUD] }]);
    view.reveal(SourceRange.of({ from: 1, to: 3 }));
    expect(menu!.value).toBe('loud');
    // the blocks are paragraphs already: taking the style off is all Normal text does
    expect(option('paragraph').disabled).toBe(false);
    choose('paragraph');
    expect(doc.text).toBe('Hello\n');
    expect(menu!.value).toBe('paragraph');
  });

  it('disables an entry that cannot apply', () => {
    const { option } = setup('Text\n', [{ provideTextStyles: () => [{ ...LOUD, enabled: () => false }] }]);
    expect(option('loud').disabled).toBe(true);
  });
});
