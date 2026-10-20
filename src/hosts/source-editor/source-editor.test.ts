// @vitest-environment jsdom
// Tests for source-editor.ts: the host's contribution points, and the Source editors it makes.
import { describe, expect, it } from 'vitest';
import { history, undo } from '@codemirror/commands';
import { EditorState, StateEffect, StateField, Transaction, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view';
import { EventEmitter } from '../../core/event-emitter/event-emitter';
import { ProjectPath } from '../../core/paths/paths';
import { SourceOffset, SourceRange, TypstDocument } from '../../core/typst-document/typst-document';
import { fromDocument, SourceEditorHost, type CodeMirrorContext } from './source-editor';

/** A Source editor of `text`, with an undo history (what the code-editing extension's basic setup gives the widget's). */
function setup(text: string, host = new SourceEditorHost()) {
  host.registerCodeMirrorExtension({ editor: 'source' }, history());
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = host.createEditor(parent, doc);
  const editor = () => EditorView.findFromDOM(parent.querySelector<HTMLElement>('.cm-editor')!)!;
  return { doc, view, parent, editor };
}

describe('SourceEditor history', () => {
  it("changes from elsewhere enter the editor's history, marked with their origin", () => {
    const { doc, editor } = setup('one two\n');
    const origins: unknown[] = [];
    editor().dispatch({ effects: StateEffect.appendConfig.of(EditorState.transactionExtender.of((tr) => (origins.push(tr.annotation(fromDocument)?.origin), null))) });
    doc.change([{ from: SourceOffset.of(4), to: SourceOffset.of(7), insert: 'TWO' }], 'visual');
    expect(origins).toEqual(['visual']);
    undo(editor());
    expect(doc.text).toBe('one two\n');
  });

  it('a contribution keeps changes of some origin out of the history (as collaboration does with other users\' edits)', () => {
    const host = new SourceEditorHost();
    host.registerCodeMirrorExtension(
      { editor: 'source' },
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

describe('SourceEditor reveal', () => {
  it('selects and highlights the range, until the text changes (also from another editor)', () => {
    const { doc, view, parent, editor } = setup('Some bold text\n');
    view.reveal(SourceRange.of({ from: 5, to: 9 }));
    expect(view.selection()).toEqual({ from: 5, to: 9 });
    expect(marked(parent, '.zwf-source__jump')).toEqual(['bold']);
    // the same selection again (as a focus re-reading the DOM does) keeps it
    editor().dispatch({ selection: { anchor: 5, head: 9 } });
    expect(marked(parent, '.zwf-source__jump')).toEqual(['bold']);
    doc.change([{ from: SourceOffset.of(0), to: SourceOffset.of(0), insert: 'Really. ' }], 'visual');
    expect(marked(parent, '.zwf-source__jump')).toEqual([]);

    view.reveal(SourceRange.of({ from: 13, to: 17 }));
    editor().dispatch({ changes: { from: 0, to: 0, insert: '!' }, userEvent: 'input.type' });
    expect(marked(parent, '.zwf-source__jump')).toEqual([]);
  });

  it('has the focus when it tells about the new selection (who follows the focused editor sees it), also from elsewhere', () => {
    const parent = document.body.appendChild(document.createElement('div'));
    const focused: boolean[] = [];
    const view = new SourceEditorHost().createEditor(parent, new TypstDocument('Some bold text\n'), {
      onSelection: () => focused.push(parent.contains(document.activeElement)),
    });
    document.body.appendChild(document.createElement('input')).focus();
    view.reveal(SourceRange.of({ from: 5, to: 9 }));
    expect(focused).toEqual([true]);
  });

  it('removes the highlight when the selection moves away', () => {
    const { view, parent, editor } = setup('Some bold text\n');
    view.reveal(SourceRange.of({ from: 5, to: 9 }));
    editor().dispatch({ selection: { anchor: 2 } });
    expect(marked(parent, '.zwf-source__jump')).toEqual([]);
  });
});

describe('SourceEditorHost contributions', () => {
  /** Marks the first word of the editor's document (as it was when the extension was made). */
  const firstWord = (editor: CodeMirrorContext) =>
    editor.editor === 'source' ? EditorView.decorations.of(Decoration.set(Decoration.mark({ class: 'first' }).range(0, editor.document.text.search(/\s/)))) : [];
  /** Marks the ranges `ranges` fires (as an extension drawing something of its own would), in a state field (one for all editors). */
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

  it('applies a registered extension to the editors made before and after, until disposed', () => {
    const host = new SourceEditorHost();
    const before = setup('alpha beta\n', host);
    const registration = host.registerCodeMirrorExtension({ editor: 'source' }, firstWord);
    const after = setup('gamma delta\n', host);
    expect(marked(before.parent, '.first')).toEqual(['alpha']);
    expect(marked(after.parent, '.first')).toEqual(['gamma']);
    registration.dispose();
    expect(marked(before.parent, '.first')).toEqual([]);
    expect(marked(after.parent, '.first')).toEqual([]);
  });

  it('keeps what an extension drew when another one is registered', () => {
    const host = new SourceEditorHost();
    host.registerCodeMirrorExtension({}, drawRanges);
    const { parent } = setup('Some bold text\n', host);
    ranges.fire([{ anchor: 5, head: 9 }]);
    host.registerCodeMirrorExtension({ editor: 'source' }, firstWord);
    expect(marked(parent, '.drawn')).toEqual(['bold']);
  });

  it('stops applying contributions to a disposed editor', () => {
    const host = new SourceEditorHost();
    const made: string[] = [];
    host.registerCodeMirrorExtension({ editor: 'source' }, (editor) => {
      if (editor.editor !== 'source') return [];
      made.push(editor.document.text);
      return [];
    });
    const { view } = setup('text\n', host);
    view.dispose();
    host.registerCodeMirrorExtension({ editor: 'source' }, firstWord);
    expect(made).toEqual(['text\n']);
  });
});

describe('CodeMirror selectors', () => {
  const PLAIN: CodeMirrorContext = { editor: 'other', languageId: 'plaintext', path: () => ProjectPath.of('/notes.txt') };
  const marker = (name: string) => EditorView.editorAttributes.of({ class: name });
  const classes = (view: EditorView) => [...view.dom.classList].filter((name) => name.startsWith('x-')).sort();

  it('apply to the Source editors and to other CodeMirrors that take them, before and after, until disposed', () => {
    const host = new SourceEditorHost();
    const { editor } = setup('text\n', host);
    const other = new EditorView({ parent: document.body, doc: 'plain', extensions: host.codeMirrorExtensionsFor(PLAIN) });
    const registration = host.registerCodeMirrorExtension({}, marker('x-all'));
    const later = new EditorView({ parent: document.body, doc: 'later', extensions: host.codeMirrorExtensionsFor(PLAIN) });
    expect([editor(), other, later].map(classes)).toEqual([['x-all'], ['x-all'], ['x-all']]);
    registration.dispose();
    expect([editor(), other, later].map(classes)).toEqual([[], [], []]);
  });

  it('select by language and kind of editor; empty: every CodeMirror', () => {
    const host = new SourceEditorHost();
    host.registerCodeMirrorExtension({}, marker('x-all'));
    host.registerCodeMirrorExtension({ language: 'typst' }, marker('x-typst'));
    host.registerCodeMirrorExtension({ editor: 'source' }, marker('x-source'));
    host.registerCodeMirrorExtension({ editor: 'rawBox' }, marker('x-box'));
    host.registerCodeMirrorExtension({ language: 'typst', editor: 'other' }, marker('x-typst-other'));
    const { editor } = setup('text\n', host);
    const shown = (context: CodeMirrorContext) => classes(new EditorView({ parent: document.body, extensions: host.codeMirrorExtensionsFor(context) }));
    const box: CodeMirrorContext = { editor: 'rawBox', languageId: 'typst', path: () => null, document: new TypstDocument('') };
    expect(classes(editor())).toEqual(['x-all', 'x-source', 'x-typst']);
    expect(shown(box)).toEqual(['x-all', 'x-box', 'x-typst']);
    expect(shown({ editor: 'other', languageId: 'typst', path: () => null })).toEqual(['x-all', 'x-typst', 'x-typst-other']);
    expect(shown(PLAIN)).toEqual(['x-all']);
  });

  it('stop following the host once the other CodeMirror is destroyed', () => {
    const host = new SourceEditorHost();
    new EditorView({ parent: document.body, doc: 'plain', extensions: host.codeMirrorExtensionsFor(PLAIN) }).destroy();
    expect(() => host.registerCodeMirrorExtension({}, marker('x-all'))).not.toThrow();
  });

  it('made per editor, know its text: a Source editor shows Typst in its file, another CodeMirror says what it shows', () => {
    const host = new SourceEditorHost();
    const seen: string[] = [];
    host.registerCodeMirrorExtension({}, ({ editor, languageId, path }) => (seen.push(`${editor} ${languageId} ${path() ?? 'nowhere'}`), []));
    host.createEditor(document.body.appendChild(document.createElement('div')), new TypstDocument('text\n'), { path: () => ProjectPath.of('/main.typ') });
    host.createEditor(document.body.appendChild(document.createElement('div')), new TypstDocument('text\n'));
    new EditorView({ parent: document.body, doc: 'plain', extensions: host.codeMirrorExtensionsFor(PLAIN) });
    expect(seen).toEqual(['source typst /main.typ', 'source typst nowhere', 'other plaintext /notes.txt']);
  });
});
