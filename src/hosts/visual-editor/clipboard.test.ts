// @vitest-environment jsdom
// Tests for clipboard.ts: copy, cut and paste of a Visual editor in Typst.
import { describe, expect, it } from 'vitest';
import { SourceRange, TypstDocument } from '../../core/typst-document/typst-document';
import { children } from '../../core/typst-syntax/typst-syntax';
import { starterKitPart, type TypstMarkSpec } from '../prosemirror-typst/prosemirror-typst';
import { VisualEditor, VisualEditorHost, type VisualEditorContribution } from './visual-editor';

/** A test-local construct beyond the host's minimum: `*strong*` as a bold mark. */
const STRONG: TypstMarkSpec = {
  name: 'bold',
  tiptap: starterKitPart('testBold', { bold: {} }),
  typst: {
    parseTypst: { syntaxNodes: { Strong: { inline: (p, node, marks) => p.inline(children(node.getChild('Markup')!), p.schema.marks.bold.create().addToSet(marks)) } } },
    toTypst: () => ({ open: '*', close: '*' }),
  },
};
const strong = { id: 'strong', activate: ({ visualEditor, subscriptions }) => subscriptions.push(visualEditor.registerMark(STRONG)) } satisfies VisualEditorContribution;

const FIGURE = '#figure(\n  mermaid(read("../diagrams/workbench-layout.mmd"), width: 75%),\n  caption: [The editor: …],\n)';

/** A Visual editor of `text`; `select` selects a source range (`reveal`), `paste`, `copy`, `cut` and `key` go to its text. */
function setup(text: string) {
  const parent = document.body.appendChild(document.createElement('div'));
  const doc = new TypstDocument(text);
  const view = new VisualEditor(parent, doc, VisualEditorHost.from([strong]));
  const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
  const select = (from: number, to = from) => view.reveal(SourceRange.of({ from, to }));
  const key = (init: KeyboardEventInit) => editable.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  const clipboardEvent = (type: string, data: FakeClipboard) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data });
    editable.dispatchEvent(event);
    return data;
  };
  return {
    doc,
    parent,
    select,
    key,
    paste: (items: Record<string, string>) => clipboardEvent('paste', new FakeClipboard(items)),
    copy: () => clipboardEvent('copy', new FakeClipboard()),
    cut: () => clipboardEvent('cut', new FakeClipboard()),
    undo: () => key({ key: 'z', ctrlKey: true }),
  };
}

/** The part of DataTransfer the editor uses (jsdom has none). */
class FakeClipboard {
  readonly items: Map<string, string>;
  readonly files: File[] = [];
  constructor(items: Record<string, string> = {}) {
    this.items = new Map(Object.entries(items));
  }
  getData(type: string): string {
    return this.items.get(type) ?? '';
  }
  setData(type: string, value: string): void {
    this.items.set(type, value);
  }
  clearData(): void {
    this.items.clear();
  }
  get types(): string[] {
    return [...this.items.keys()];
  }
}

describe('paste', () => {
  it('reads pasted text as Typst: a call no spec models becomes a raw box with its exact source', () => {
    const { doc, parent, select, paste } = setup('Intro\n');
    select(5);
    paste({ 'text/plain': FIGURE });
    expect(doc.text).toBe(`Intro\n\n${FIGURE}\n`);
    expect(parent.querySelector('.typst-visual__raw-block')).not.toBeNull();
  });

  it('puts inline content into the text, in place of the selection', () => {
    const { doc, parent, select, paste } = setup('Some old text.\n');
    select(5, 8);
    paste({ 'text/plain': '*bold* text' });
    expect(doc.text).toBe('Some *bold* text text.\n');
    expect(parent.querySelector('strong')?.textContent).toBe('bold');
  });

  it('is undone in one step', () => {
    const { doc, select, paste, undo } = setup('Some old text.\n');
    select(5, 8);
    paste({ 'text/plain': `*bold*\n\n${FIGURE}\n\nmore` });
    expect(doc.text).toBe(`Some *bold*\n\n${FIGURE}\n\nmore text.\n`);
    undo();
    expect(doc.text).toBe('Some old text.\n');
  });

  it('reads code a code editor copied as HTML (one preformatted block) as Typst', () => {
    const { doc, select, paste } = setup('Text\n');
    select(4);
    const html = '<meta charset="utf-8"><div style="color: #d4d4d4; white-space: pre;"><div><span>*bold*</span></div></div>';
    paste({ 'text/plain': '*bold*', 'text/html': html });
    expect(doc.text).toBe('Text*bold*\n');
  });

  it('pastes other HTML through the schema, as before', () => {
    const { doc, select, paste } = setup('Text\n');
    select(4);
    paste({ 'text/plain': '*x*', 'text/html': '<p>*x*</p>' });
    expect(doc.text).toBe('Text\\*x\\*\n');
  });

  it('pastes the text as plain characters after Mod+Shift+V', () => {
    const { doc, select, paste, key } = setup('Text\n');
    select(4);
    key({ key: 'V', code: 'KeyV', ctrlKey: true, shiftKey: true });
    paste({ 'text/plain': ' *bold*' });
    expect(doc.text).toBe('Text \\*bold\\*\n');
    paste({ 'text/plain': ' *again*' });
    expect(doc.text).toBe('Text \\*bold\\* *again*\n');
  });
});

describe('copy', () => {
  it('puts the Typst source of the selection on the clipboard as text, and HTML along', () => {
    const source = 'Some *bold* text.\n';
    const { select, copy } = setup(source);
    select(0, source.indexOf('.'));
    const data = copy();
    expect(data.getData('text/plain')).toBe('Some *bold* text');
    expect(data.getData('text/html')).toContain('<strong>bold</strong>');
  });

  it('copies raw boxes byte for byte', () => {
    const source = `Intro\n\n${FIGURE}\n\nEnd.\n`;
    const { select, copy } = setup(source);
    select(0, source.length - 1);
    expect(copy().getData('text/plain')).toBe(source.trimEnd());
  });

  it('prints a selection anew where its source would not read the same (part of a bold word)', () => {
    const source = 'Some *bold* text.\n';
    const { select, copy } = setup(source);
    select(source.indexOf('ld'), source.indexOf(' text'));
    expect(copy().getData('text/plain')).toBe('*ld*');
  });

  it('cuts the selection, its Typst on the clipboard', () => {
    const source = 'Some *bold* text.\n';
    const { doc, select, cut } = setup(source);
    select(4, source.indexOf('.'));
    expect(cut().getData('text/plain')).toBe(' *bold* text');
    expect(doc.text).toBe('Some.\n');
  });

  it('round-trips: what is copied pastes back byte for byte, as Typst text and as HTML', () => {
    const source = `Some *bold* text, an escaped \\* star.\n\n= A heading (raw here)\n\n${FIGURE}\n\nEnd.\n`;
    const { select, copy } = setup(source);
    select(0, source.length - 1);
    const data = copy();
    expect(data.getData('text/plain')).toBe(source.trimEnd());
    for (const items of [{ 'text/plain': data.getData('text/plain') }, Object.fromEntries(data.items)]) {
      const target = setup('');
      target.select(0);
      target.paste(items);
      expect(target.doc.text).toBe(source.trimEnd());
    }
  });
});
