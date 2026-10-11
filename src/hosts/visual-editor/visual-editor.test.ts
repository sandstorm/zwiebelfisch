// @vitest-environment jsdom
// Tests for visual-editor.ts.
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import { SourceOffset, SourceRange, TypstDocument } from '../../core/typst-document/typst-document';
import { Node as TiptapNode, type Editor } from '@tiptap/core';
import { children, withHash } from '../../core/typst-syntax/typst-syntax';
import { starterKitPart, type TypstMarkSpec } from '../prosemirror-typst/prosemirror-typst';
import { insertTypstBlocks, setRawBoxDecorations, VisualEditor, VisualEditorHost, type SourceHighlight, type TypstNodeSpec, type VisualEditorContext, type VisualEditorContribution } from './visual-editor';

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


  it('reports the selection as the source range it shows', () => {
    const source = 'Title\n\nSome *bold* text.\n';
    const { view } = setup(source);
    const from = source.indexOf('bold');
    view.reveal(SourceRange.of({ from: from, to: from + 4 }));
    expect(view.selection()).toEqual({ from, to: from + 4 });
  });

  it('follows document changes made elsewhere', () => {
    const { doc, parent } = setup('Title\n\nText\n');
    doc.setText('Title\n\nText changed\n', 'source');
    expect(parent.querySelectorAll('p')[1]?.textContent).toBe('Text changed');
  });

  it('marks the DOM of a node whose spec owns its pseudo-elements', () => {
    const divider: TypstNodeSpec = {
      name: 'divider',
      tiptap: TiptapNode.create({ name: 'divider', group: 'block', atom: true, addAttributes: () => ({ src: { default: '', rendered: false } }), renderHTML: () => ['hr'] }),
      typst: { parseTypst: { calls: { divider: { block: (p, call) => p.schema.nodes.divider.create({ src: p.text(withHash(call)) }) } } } },
      view: { ownsPseudoElements: true },
    };
    const parent = document.body.appendChild(document.createElement('div'));
    new VisualEditor(parent, new TypstDocument('#divider()\n\nText\n'), VisualEditorHost.from([{ id: 'divider', activate: ({ visualEditor }) => visualEditor.registerNode(divider) }]));
    expect(parent.querySelector('hr')?.getAttribute('data-typst-pseudo')).toBe('own');
    expect(parent.querySelector('p')?.hasAttribute('data-typst-pseudo')).toBe(false);
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

  it('keeps highlights on their text through edits from elsewhere', () => {
    const source = 'Some bold text\n';
    const { doc, parent } = withHighlights(source, [{ from: SourceOffset.of(5), to: SourceOffset.of(9), className: 'note' }]);
    doc.setText(`Really. ${source}`, 'source');
    expect(parent.querySelector('.note')?.textContent).toBe('bold');
  });
});

/** A view of `text` (with `strong`) and a highlight provider whose highlights start as `initial`; `highlights` sets new ones. */
function withHighlights(text: string, initial: SourceHighlight[]) {
  let current = initial;
  const changed = new EventEmitter<TypstDocument>();
  const contributions = VisualEditorHost.from([strong]);
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
    contributions.registerTiptapExtension((view) => {
      seenBy.push(view);
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

describe('insertTypstBlocks', () => {
  /** A view of `text` with the cursor after `cursorAfter`, and its editor. */
  function at(text: string, cursorAfter: number) {
    const { doc, view, parent } = setup(text);
    view.reveal(SourceRange.of({ from: cursorAfter, to: cursorAfter }));
    const editor = (parent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
    return { doc, editor };
  }

  it('inserts the blocks the Typst is read as after the paragraph holding the cursor', () => {
    const { doc, editor } = at('Title\n\nSome text\n', 9);
    insertTypstBlocks(editor, '#figure(sheets.Sheet1, caption: [ ])');
    expect(doc.text).toBe('Title\n\nSome text\n\n#figure(sheets.Sheet1, caption: [ ])\n');
    expect(editor.state.doc.child(2).type.name).toBe('rawBlock');
  });

  it('takes over an empty paragraph', () => {
    const { doc, editor } = at('Title\n', 5);
    editor.commands.splitBlock();
    insertTypstBlocks(editor, '#box[x]');
    expect(doc.text).toBe('Title\n\n#box[x]\n');
    expect(editor.state.doc.childCount).toBe(2);
  });
});
