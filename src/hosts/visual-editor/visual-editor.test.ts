// @vitest-environment jsdom
// Tests for visual-editor.ts.
import { EditorState } from '@codemirror/state';
import { EditorView as CodeView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import { SourceOffset, SourceRange, TypstDocument } from '../../core/typst-document/typst-document';
import { Extension, type AnyExtension, type Editor } from '@tiptap/core';
import { children } from '../../core/typst-syntax/typst-syntax';
import { starterKitPart, type TypstMarkSpec } from '../prosemirror-typst/prosemirror-typst';
import { insertTypst, setRawBoxDecorations, VisualEditor, VisualEditorHost, type SourceHighlight, type VisualEditorContext, type VisualEditorContribution } from './visual-editor';

/** A test-local construct beyond the host's minimum: `*strong*` as a bold mark (hidden syntax around visible text). */
const STRONG: TypstMarkSpec = {
  name: 'bold',
  tiptap: starterKitPart('testBold', { bold: {} }),
  typst: {
    parseTypst: { syntaxNodes: { Strong: { inline: (p, node, marks) => p.inline(children(node.getChild('Markup')!), p.schema.marks.bold.create().addToSet(marks)) } } },
    toTypst: () => ({ open: '*', close: '*' }),
  },
};
const strong = { id: 'strong', activate: ({ visualEditor, subscriptions }) => subscriptions.push(visualEditor.registerMark(STRONG)) } satisfies VisualEditorContribution;

function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = new VisualEditor(parent, doc, VisualEditorHost.from([strong]));
  const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
  return { doc, view, editable, parent };
}

describe('VisualEditor', () => {
  it('renders the parsed document', () => {
    const { parent } = setup('Title\n\nSome *bold* text.\n');
    expect(parent.querySelector('p')?.textContent).toBe('Title');
    expect(parent.querySelector('strong')?.textContent).toBe('bold');
  });

  it('reveals a source range by selecting exactly what shows it', () => {
    const source = 'Title\n\nSome *bold* text.\n';
    const { view } = setup(source);
    view.reveal(SourceRange.of({ from: source.indexOf('bold'), to: source.indexOf('bold') + 4 }));
    expect(window.getSelection()?.toString()).toBe('bold');
  });


  it('reveals a source range scrolled into view also while the focus is elsewhere (a link followed from another file)', () => {
    const source = 'Title\n\nSome *bold* text.\n';
    const { view, editable } = setup(source);
    const outside = document.body.appendChild(document.createElement('input'));
    outside.focus();
    const scrolledTo: number[] = [];
    const pm = (editable as HTMLElement & { editor: Editor }).editor.view;
    // ProseMirror scrolls to the DOM's selection: called only when that is in the editor
    pm.setProps({ handleScrollToSelection: (v) => scrolledTo.push(v.state.selection.head) > 0 });
    view.reveal(SourceRange.of({ from: source.indexOf('text'), to: source.indexOf('text') }));
    expect(scrolledTo).toEqual([pm.state.selection.head]);
    expect(document.activeElement).toBe(editable);
    expect(view.selection().from).toBe(source.indexOf('text'));
  });

  it('reveals a range inside a raw box in its code, selected; the whole box or a caret before it in the text', () => {
    const source = 'Some #emph(text) here\n\n#set text(size: 12pt)\n';
    const { view, parent } = setup(source);
    const code = (selector: string) => CodeView.findFromDOM(parent.querySelector<HTMLElement>(`${selector} .cm-content`)!)!;
    const reveal = (from: number, to: number) => view.reveal(SourceRange.of({ from, to }));
    const selected = (box: CodeView) => box.state.sliceDoc(box.state.selection.main.from, box.state.selection.main.to);
    reveal(source.indexOf('size'), source.indexOf('size') + 4);
    expect(selected(code('.zwf-visual__raw-block'))).toBe('size');
    expect(code('.zwf-visual__raw-block').hasFocus).toBe(true);
    reveal(source.indexOf('(text)') + 1, source.indexOf('(text)') + 5);
    expect(selected(code('.zwf-visual__raw-inline'))).toBe('text');
    const block = source.indexOf('#set');
    reveal(block, block);
    expect(code('.zwf-visual__raw-block').hasFocus).toBe(false);
    reveal(block, source.length - 1);
    expect(code('.zwf-visual__raw-block').hasFocus).toBe(false);
    expect(view.selection()).toEqual({ from: block, to: source.length - 1 });
  });

  it('reports the selection as the source range it shows', () => {
    const source = 'Title\n\nSome *bold* text.\n';
    const { view } = setup(source);
    const from = source.indexOf('bold');
    view.reveal(SourceRange.of({ from: from, to: from + 4 }));
    expect(view.selection()).toEqual({ from, to: from + 4 });
  });

  it('reports a revealed range no position shows exactly as revealed (to whom it tells), until the selection moves or the text changes', () => {
    const source = 'Title\n\nSome text.\n';
    // between the paragraphs (as a figure's label is): the cursor goes to the start of the next one
    const gap = SourceOffset.of(source.indexOf('\n\nSome') + 1);
    const { doc, view, editable } = setup(source);
    const told: SourceRange[] = [];
    view.onDidChangeSelection(() => told.push(view.selection()));
    view.reveal(SourceRange.of({ from: gap, to: gap }));
    expect([told, view.selection()]).toEqual([[{ from: gap, to: gap }], { from: gap, to: gap }]);
    const pm = (editable as HTMLElement & { editor: Editor }).editor;
    pm.commands.setTextSelection(pm.state.selection.from + 1);
    expect(view.selection().from).toBe(source.indexOf('Some') + 1);

    view.reveal(SourceRange.of({ from: gap, to: gap }));
    doc.setText('Title\n\nSome text, changed.\n', 'source');
    expect(view.selection().from).toBe(source.indexOf('Some'));
  });

  it('follows document changes made elsewhere', () => {
    const { doc, parent } = setup('Title\n\nText\n');
    doc.setText('Title\n\nText changed\n', 'source');
    expect(parent.querySelectorAll('p')[1]?.textContent).toBe('Text changed');
  });
});

describe('VisualEditorHost.registerHighlights', () => {
  it('sets a provider\'s highlights when a view is made and again when they change for its document only', () => {
    const changed = new EventEmitter<TypstDocument>();
    const ranges = new Map<TypstDocument, SourceHighlight[]>();
    const contributions = new VisualEditorHost();
    contributions.registerHighlights('test', { provideHighlights: (document) => ranges.get(document) ?? [], onDidChangeHighlights: changed.event });
    const doc = new TypstDocument('Hello world\n');
    const other = new TypstDocument('Other\n');
    ranges.set(doc, [{ from: SourceOffset.of(0), to: SourceOffset.of(5), className: 'marked' }]);
    const parent = document.body.appendChild(document.createElement('div'));
    const view = new VisualEditor(parent, doc, contributions);
    expect(parent.querySelector('.marked')?.textContent).toBe('Hello');
    ranges.set(doc, [{ from: SourceOffset.of(6), to: SourceOffset.of(11), className: 'marked' }]);
    changed.fire(other);
    expect(parent.querySelector('.marked')?.textContent).toBe('Hello');
    changed.fire(doc);
    expect(parent.querySelector('.marked')?.textContent).toBe('world');
    view.dispose();
    expect(changed.hasListeners).toBe(false);
  });

  it('draws highlights given in source offsets over the visible text', () => {
    const source = 'Title\n\nSome *bold* text.\n';
    const from = source.indexOf('bold');
    const { highlights, parent } = withHighlights(source, [{ from: SourceOffset.of(from - 1), to: SourceOffset.of(from + 5), className: 'note', attributes: { 'data-user': 'a' } }]);
    expect([...parent.querySelectorAll('.note[data-user="a"]')].map((e) => e.textContent).join('')).toBe('bold');
    highlights([]);
    expect(parent.querySelector('.note')).toBeNull();
  });

  it('makes no transaction when there were no highlights and there are none (a compile without errors)', () => {
    let transactions = 0;
    const counter = Extension.create({ name: 'counter', onTransaction: () => void transactions++ });
    const { highlights } = withHighlights('Some text\n', [], [counter]);
    highlights([]);
    expect(transactions).toBe(0);
    highlights([{ from: SourceOffset.of(0), to: SourceOffset.of(4), className: 'note' }]);
    highlights([]);
    highlights([]);
    expect(transactions).toBe(2);
  });

  it('keeps highlights on their text through edits from elsewhere', () => {
    const source = 'Some bold text\n';
    const { doc, parent } = withHighlights(source, [{ from: SourceOffset.of(5), to: SourceOffset.of(9), className: 'note' }]);
    doc.setText(`Really. ${source}`, 'source');
    expect(parent.querySelector('.note')?.textContent).toBe('bold');
  });
});

/**
 * A Visual editor of `text` (with `strong` and the Tiptap extensions `extensions`) and a highlight provider whose
 * highlights start as `initial`; `highlights` sets new ones.
 */
function withHighlights(text: string, initial: SourceHighlight[], extensions: AnyExtension[] = []) {
  let current = initial;
  const changed = new EventEmitter<TypstDocument>();
  const contributions = VisualEditorHost.from([strong]);
  contributions.registerTiptapExtension(() => extensions);
  contributions.registerHighlights('test', { provideHighlights: () => current, onDidChangeHighlights: changed.event });
  const doc = new TypstDocument(text);
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new VisualEditor(parent, doc, contributions);
  const highlights = (next: SourceHighlight[]) => {
    current = next;
    changed.fire(doc);
  };
  return { doc, view, parent, highlights };
}

describe('VisualEditor contexts', () => {
  it('give contributions the source ↔ position mapping and which nodes are boxes', () => {
    const contributions = new VisualEditorHost();
    const seen: { pos: number; offset: number; boxes: string[] }[] = [];
    const seenBy: VisualEditorContext[] = [];
    contributions.registerTiptapExtension((editor) => {
      seenBy.push(editor);
      return [];
    });
    const parent = document.body.appendChild(document.createElement('div'));
    const source = 'Hello\n\n#set page(width: 10cm)\n';
    const view = new VisualEditor(parent, new TypstDocument(source), contributions);
    const editor = (parent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
    const [context] = seenBy;
    const doc = editor.state.doc;
    const boxes: string[] = [];
    doc.descendants((node) => void (context.isBox(node) && boxes.push(node.type.name)));
    seen.push({ pos: context.sourceToPos(doc, SourceOffset.of(source.indexOf('llo'))), offset: context.posToSource(doc, 3), boxes });
    expect(seen).toEqual([{ pos: 3, offset: 2, boxes: ['rawBlock'] }]);
    view.dispose();
  });

  it("gives a raw box's code its decorations (setRawBoxDecorations), when made and on every update", () => {
    const contributions = new VisualEditorHost();
    const given: number[] = [];
    contributions.registerRawBoxCodeMirrorExtension(() =>
      EditorState.transactionExtender.of((tr) => {
        for (const effect of tr.effects) if (effect.is(setRawBoxDecorations)) given.push(effect.value.length);
        return null;
      }),
    );
    const parent = document.body.appendChild(document.createElement('div'));
    const doc = new TypstDocument('Intro\n\n#set page(width: 10cm)\n');
    const view = new VisualEditor(parent, doc, contributions);
    expect(given).toEqual([0]);
    doc.setText('Intro\n\n#set page(width: 12cm)\n', 'test');
    expect(given).toEqual([0, 0]);
    view.dispose();
  });
});

describe('insertTypst', () => {
  /** A Visual editor of `text` with the cursor after `cursorAfter`, and its editor. */
  function at(text: string, cursorAfter: number) {
    const { doc, view, parent } = setup(text);
    view.reveal(SourceRange.of({ from: cursorAfter, to: cursorAfter }));
    const editor = (parent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
    return { doc, editor };
  }

  it('inserts the blocks the Typst is read as after the paragraph holding the cursor', () => {
    const { doc, editor } = at('Title\n\nSome text\n', 9);
    insertTypst(editor, '#figure(sheets.Sheet1, caption: [ ])');
    expect(doc.text).toBe('Title\n\nSome text\n\n#figure(sheets.Sheet1, caption: [ ])\n');
    expect(editor.state.doc.child(2).type.name).toBe('rawBlock');
  });

  it('takes over an empty paragraph', () => {
    const { doc, editor } = at('Title\n', 5);
    editor.commands.splitBlock();
    insertTypst(editor, '#box[x]');
    expect(doc.text).toBe('Title\n\n#box[x]\n');
    expect(editor.state.doc.childCount).toBe(2);
  });

  it("puts one paragraph's inline content into the text, in place of the selection", () => {
    const { doc, editor } = at('Some text\n', 4);
    insertTypst(editor, '*bold*');
    expect(doc.text).toBe('Some*bold* text\n');
    editor.commands.setTextSelection({ from: 1, to: 5 });
    insertTypst(editor, 'Any');
    expect(doc.text).toBe('Any*bold* text\n');
  });

  it('takes over an empty paragraph also with changes before it (an import)', () => {
    const { doc, editor } = at('Title\n\nThe runs:\n', 18);
    editor.commands.splitBlock();
    insertTypst(editor, '#figure(sheets.Sheet1, caption: [ ])', undefined, [{ from: SourceOffset.of(0), to: SourceOffset.of(0), insert: '#import "t.typ": sheets\n\n' }]);
    expect(doc.text).toBe('#import "t.typ": sheets\n\nTitle\n\nThe runs:\n\n#figure(sheets.Sheet1, caption: [ ])\n');
  });

  it('inserts at a position given (a drop) instead of the selection', () => {
    const { doc, editor } = at('Title\n\nSome text\n', 0);
    // position 3: after "Ti"
    insertTypst(editor, '*b*', 3);
    expect(doc.text).toBe('Ti*b*tle\n\nSome text\n');
    insertTypst(editor, '#figure(sheets.Sheet1, caption: [ ])', 3);
    expect(doc.text).toBe('Ti*b*tle\n\n#figure(sheets.Sheet1, caption: [ ])\n\nSome text\n');
  });
});
