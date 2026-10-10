// @vitest-environment jsdom
// Tests for visual-view.ts.
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import { TypstDocument } from '../../core/typst-document/typst-document';
import type { Editor } from '@tiptap/core';
import {
  children, setBoxDecorations, starterKitPart, VisualView, VisualViewContributions, type Highlight, type TypstMarkSpec, type VisualViewContext, type VisualViewContribution,
} from './visual-view';

/** A test-local construct beyond the host's minimum: `*strong*` as a bold mark (hidden syntax around visible text). */
const STRONG: TypstMarkSpec = {
  name: 'bold',
  extension: starterKitPart('testBold', { bold: {} }),
  inlineSyntax: { Strong: (p, node, marks) => p.inline(children(node.getChild('Markup')!), p.schema.marks.bold.create().addToSet(marks)) },
  print: () => ({ open: '*', close: '*' }),
};
const strong = { id: 'strong', activate: ({ visualView, subscriptions }) => subscriptions.push(visualView.registerMark(STRONG)) } satisfies VisualViewContribution;

function setup(text: string) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = new VisualView(parent, doc, VisualViewContributions.from([strong]));
  const editable = parent.querySelector<HTMLElement>('[contenteditable]')!;
  return { doc, view, editable, parent };
}

describe('VisualView', () => {
  it('renders the projected document', () => {
    const { parent } = setup('Title\n\nSome *bold* text.\n');
    expect(parent.querySelector('p')?.textContent).toBe('Title');
    expect(parent.querySelector('strong')?.textContent).toBe('bold');
  });

  it('reveals a source range by selecting exactly what shows it', () => {
    const source = 'Title\n\nSome *bold* text.\n';
    const { view } = setup(source);
    view.reveal(source.indexOf('bold'), source.indexOf('bold') + 4);
    expect(window.getSelection()?.toString()).toBe('bold');
  });

  it('draws highlights given in source offsets over the visible text', () => {
    const source = 'Title\n\nSome *bold* text.\n';
    const { view, parent } = setup(source);
    const from = source.indexOf('bold');
    view.setHighlights('cursors', [{ from: from - 1, to: from + 5, className: 'note', attributes: { 'data-user': 'a' } }]);
    expect([...parent.querySelectorAll('.note[data-user="a"]')].map((e) => e.textContent).join('')).toBe('bold');
    view.setHighlights('cursors', []);
    expect(parent.querySelector('.note')).toBeNull();
  });

  it('keeps highlights on their text through edits from elsewhere', () => {
    const source = 'Some bold text\n';
    const { doc, view, parent } = setup(source);
    view.setHighlights('cursors', [{ from: 5, to: 9, className: 'note' }]);
    doc.setText(`Really. ${source}`, 'source');
    expect(parent.querySelector('.note')?.textContent).toBe('bold');
  });

  it('reports the selection as the source range it shows', () => {
    const source = 'Title\n\nSome *bold* text.\n';
    const { view } = setup(source);
    const from = source.indexOf('bold');
    view.reveal(from, from + 4);
    expect(view.selection()).toEqual({ from, to: from + 4 });
  });

  it('follows document changes made elsewhere', () => {
    const { doc, parent } = setup('Title\n\nText\n');
    doc.setText('Title\n\nText changed\n', 'source');
    expect(parent.querySelectorAll('p')[1]?.textContent).toBe('Text changed');
  });
});

describe('VisualViewContributions.registerHighlights', () => {
  it('sets a provider\'s highlights when a view is made and again when they change for its document only', () => {
    const changed = new EventEmitter<TypstDocument>();
    const ranges = new Map<TypstDocument, Highlight[]>();
    const contributions = new VisualViewContributions();
    contributions.registerHighlights('test', { provideHighlights: (document) => ranges.get(document) ?? [], onDidChangeHighlights: changed.event });
    const doc = new TypstDocument('Hello world\n');
    const other = new TypstDocument('Other\n');
    ranges.set(doc, [{ from: 0, to: 5, className: 'marked' }]);
    const parent = document.body.appendChild(document.createElement('div'));
    const view = new VisualView(parent, doc, contributions);
    expect(parent.querySelector('.marked')?.textContent).toBe('Hello');
    ranges.set(doc, [{ from: 6, to: 11, className: 'marked' }]);
    changed.fire(other);
    expect(parent.querySelector('.marked')?.textContent).toBe('Hello');
    changed.fire(doc);
    expect(parent.querySelector('.marked')?.textContent).toBe('world');
    view.destroy();
    expect(changed.hasListeners).toBe(false);
  });
});

describe('VisualView contexts', () => {
  it('give contributions the source ↔ position mapping and which nodes are boxes', () => {
    const contributions = new VisualViewContributions();
    const seen: { pos: number; offset: number; boxes: string[] }[] = [];
    const seenBy: VisualViewContext[] = [];
    contributions.registerEditorExtension((view) => {
      seenBy.push(view);
      return [];
    });
    const parent = document.body.appendChild(document.createElement('div'));
    const source = 'Hello\n\n#set page(width: 10cm)\n';
    const view = new VisualView(parent, new TypstDocument(source), contributions);
    const editor = (parent.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor;
    const [context] = seenBy;
    const doc = editor.state.doc;
    const boxes: string[] = [];
    doc.descendants((node) => void (context.isBox(node) && boxes.push(node.type.name)));
    seen.push({ pos: context.sourceToPos(doc, source.indexOf('llo')), offset: context.posToSource(doc, 3), boxes });
    expect(seen).toEqual([{ pos: 3, offset: 2, boxes: ['rawBlock'] }]);
    view.destroy();
  });

  it("gives a raw box's code its decorations (setBoxDecorations), when made and on every update", () => {
    const contributions = new VisualViewContributions();
    const given: number[] = [];
    contributions.registerBoxCodeExtension(() =>
      EditorState.transactionExtender.of((tr) => {
        for (const effect of tr.effects) if (effect.is(setBoxDecorations)) given.push(effect.value.length);
        return null;
      }),
    );
    const parent = document.body.appendChild(document.createElement('div'));
    const doc = new TypstDocument('Intro\n\n#set page(width: 10cm)\n');
    const view = new VisualView(parent, doc, contributions);
    expect(given).toEqual([0]);
    doc.setText('Intro\n\n#set page(width: 12cm)\n', 'test');
    expect(given).toEqual([0, 0]);
    view.destroy();
  });
});
