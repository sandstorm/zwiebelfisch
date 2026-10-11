// @vitest-environment jsdom
// Tests for source-view.ts: the host's contribution points, and the Source views it makes.
import { describe, expect, it } from 'vitest';
import { undo } from '@codemirror/commands';
import { EditorState, StateEffect, StateField, Transaction, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import { SourceOffset, SourceRange, TypstDocument } from '../../core/typst-document/typst-document';
import { fromDocument, SourceViewHost, type SourceViewContext } from './source-view';

function setup(text: string, host = new SourceViewHost()) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = host.createView(parent, doc);
  const editor = () => EditorView.findFromDOM(parent.querySelector<HTMLElement>('.cm-editor')!)!;
  return { doc, view, parent, editor };
}

describe('SourceView history', () => {
  it("changes from elsewhere enter the view's history, marked with their origin", () => {
    const { doc, editor } = setup('one two\n');
    const origins: unknown[] = [];
    editor().dispatch({ effects: StateEffect.appendConfig.of(EditorState.transactionExtender.of((tr) => (origins.push(tr.annotation(fromDocument)?.origin), null))) });
    doc.change([{ from: SourceOffset.of(4), to: SourceOffset.of(7), insert: 'TWO' }], 'visual');
    expect(origins).toEqual(['visual']);
    undo(editor());
    expect(doc.text).toBe('one two\n');
  });

  it('a contribution keeps changes of some origin out of the history (as collaboration does with other users\' edits)', () => {
    const host = new SourceViewHost();
    host.registerCodeMirrorExtension(
      EditorState.transactionExtender.of((tr) => (tr.annotation(fromDocument)?.origin === 'other user' ? { annotations: Transaction.addToHistory.of(false) } : null)),
    );
    const { doc, editor } = setup('one two\n', host);
    editor().dispatch({ changes: { from: 0, to: 3, insert: 'ONE' }, userEvent: 'input.type' });
    doc.change([{ from: SourceOffset.of(4), to: SourceOffset.of(7), insert: 'TWO' }], 'other user');
    undo(editor());
    expect(doc.text).toBe('one TWO\n');
  });
});

const marked = (parent: HTMLElement, selector: string) =>
  [...parent.querySelectorAll(selector)].map((element) => element.textContent);

describe('SourceView reveal', () => {
  it('selects and highlights the range, until the text changes (also from another view)', () => {
    const { doc, view, parent, editor } = setup('Some bold text\n');
    view.reveal(SourceRange.of({ from: 5, to: 9 }));
    expect(view.selection()).toEqual({ from: 5, to: 9 });
    expect(marked(parent, '.typst-source__jump')).toEqual(['bold']);
    // the same selection again (as a focus re-reading the DOM does) keeps it
    editor().dispatch({ selection: { anchor: 5, head: 9 } });
    expect(marked(parent, '.typst-source__jump')).toEqual(['bold']);
    doc.change([{ from: SourceOffset.of(0), to: SourceOffset.of(0), insert: 'Really. ' }], 'visual');
    expect(marked(parent, '.typst-source__jump')).toEqual([]);

    view.reveal(SourceRange.of({ from: 13, to: 17 }));
    editor().dispatch({ changes: { from: 0, to: 0, insert: '!' }, userEvent: 'input.type' });
    expect(marked(parent, '.typst-source__jump')).toEqual([]);
  });

  it('removes the highlight when the selection moves away', () => {
    const { view, parent, editor } = setup('Some bold text\n');
    view.reveal(SourceRange.of({ from: 5, to: 9 }));
    editor().dispatch({ selection: { anchor: 2 } });
    expect(marked(parent, '.typst-source__jump')).toEqual([]);
  });
});

describe('SourceViewHost contributions', () => {
  /** Marks the first word of the view's document (as it was when the extension was made). */
  const firstWord = ({ document }: SourceViewContext) =>
    EditorView.decorations.of(Decoration.set(Decoration.mark({ class: 'first' }).range(0, document.text.search(/\s/))));
  /** Marks the ranges `ranges` fires (as an extension drawing something of its own would), in a state field (one for all views). */
  const drawn = StateEffect.define<readonly { anchor: number; head: number }[]>();
  const ranges = new EventEmitter<readonly { anchor: number; head: number }[]>();
  const drawing = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(set, tr) {
      const given = tr.effects.find((effect) => effect.is(drawn));
      if (!given) return set.map(tr.changes);
      return Decoration.set(given.value.map(({ anchor, head }) => Decoration.mark({ class: 'drawn' }).range(anchor, head)));
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  const drawRanges: Extension = [
    drawing,
    ViewPlugin.define((editor) => {
      const subscription = ranges.event((given) => editor.dispatch({ effects: drawn.of(given) }));
      return { destroy: () => subscription.dispose() };
    }),
  ];

  it('applies a registered extension to the views made before and after, until disposed', () => {
    const host = new SourceViewHost();
    const before = setup('alpha beta\n', host);
    const registration = host.registerCodeMirrorExtension(firstWord);
    const after = setup('gamma delta\n', host);
    expect(marked(before.parent, '.first')).toEqual(['alpha']);
    expect(marked(after.parent, '.first')).toEqual(['gamma']);
    registration.dispose();
    expect(marked(before.parent, '.first')).toEqual([]);
    expect(marked(after.parent, '.first')).toEqual([]);
  });

  it('keeps what an extension drew when another one is registered', () => {
    const host = new SourceViewHost();
    host.registerCodeMirrorExtension(drawRanges);
    const { parent } = setup('Some bold text\n', host);
    ranges.fire([{ anchor: 5, head: 9 }]);
    host.registerCodeMirrorExtension(firstWord);
    expect(marked(parent, '.drawn')).toEqual(['bold']);
  });

  it('stops applying contributions to a disposed view', () => {
    const host = new SourceViewHost();
    const made: string[] = [];
    host.registerCodeMirrorExtension(({ document }) => {
      made.push(document.text);
      return [];
    });
    const { view } = setup('text\n', host);
    view.dispose();
    host.registerCodeMirrorExtension(firstWord);
    expect(made).toEqual(['text\n']);
  });
});
