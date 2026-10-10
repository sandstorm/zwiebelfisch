// @vitest-environment jsdom
// Tests for source-view.ts: the host's contribution points, and the Source view it makes (view.ts).
import { describe, expect, it } from 'vitest';
import { undo } from '@codemirror/commands';
import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from '@codemirror/view';
import { type Presence, REMOTE_ORIGIN, TypstDocument } from '../../core/typst-document/typst-document';
import { SourceViewHost, type SourceViewExtension } from './source-view';

function setup(text: string, host = new SourceViewHost()) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const doc = new TypstDocument(text);
  const view = host.createView(parent, doc);
  const editor = () => EditorView.findFromDOM(parent.querySelector<HTMLElement>('.cm-editor')!)!;
  return { doc, view, parent, editor };
}

describe('SourceView history', () => {
  it('undo reverts only local edits, not those of collaborators', () => {
    const { doc, editor } = setup('one two\n');
    editor().dispatch({ changes: { from: 0, to: 3, insert: 'ONE' }, userEvent: 'input.type' });
    doc.change([{ from: 4, to: 7, insert: 'TWO' }], REMOTE_ORIGIN);
    undo(editor());
    expect(doc.text).toBe('one TWO\n');
  });
});

const marked = (parent: HTMLElement, selector: string) =>
  [...parent.querySelectorAll(selector)].map((element) => element.textContent);

describe('SourceView reveal', () => {
  it('selects and highlights the range; the highlight follows edits', () => {
    const { doc, view, parent } = setup('Some bold text\n');
    view.reveal(5, 9);
    expect(view.selection()).toEqual({ from: 5, to: 9 });
    expect(marked(parent, '.typst-source__jump')).toEqual(['bold']);
    doc.change([{ from: 0, to: 0, insert: 'Really. ' }], 'visual');
    expect(marked(parent, '.typst-source__jump')).toEqual(['bold']);
  });
});

describe('SourceViewHost contributions', () => {
  /** Marks the first word of the view's document (as it was when the extension was made). */
  const firstWord: SourceViewExtension = ({ document }) =>
    EditorView.decorations.of(Decoration.set(Decoration.mark({ class: 'first' }).range(0, document.text.search(/\s/))));
  /** Marks the selections of the presences the view is given (`onDidChangePresence`), in a state field (one for all views). */
  const drawn = StateEffect.define<readonly Presence[]>();
  const drawing = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(set, tr) {
      const given = tr.effects.find((effect) => effect.is(drawn));
      if (!given) return set.map(tr.changes);
      return Decoration.set(given.value.map(({ anchor, head }) => Decoration.mark({ class: 'drawn' }).range(anchor, head)));
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  const drawPresence: SourceViewExtension = (view) => [
    drawing,
    ViewPlugin.define((editor) => {
      const subscription = view.onDidChangePresence((presences) => editor.dispatch({ effects: drawn.of(presences) }));
      return { destroy: () => subscription.dispose() };
    }),
  ];

  it('applies a registered extension to the views made before and after, until disposed', () => {
    const host = new SourceViewHost();
    const before = setup('alpha beta\n', host);
    const registration = host.registerExtension(firstWord);
    const after = setup('gamma delta\n', host);
    expect(marked(before.parent, '.first')).toEqual(['alpha']);
    expect(marked(after.parent, '.first')).toEqual(['gamma']);
    registration.dispose();
    expect(marked(before.parent, '.first')).toEqual([]);
    expect(marked(after.parent, '.first')).toEqual([]);
  });

  it('gives each view the links of the first link provider that has some for its document', () => {
    const host = new SourceViewHost();
    const seen: (string | null)[] = [];
    host.registerExtension(({ documentLinks }) => {
      seen.push(documentLinks ? 'links' : null);
      return [];
    });
    setup('text\n', host);
    host.registerLinkProvider(() => null);
    expect(seen).toEqual([null, null]);
    const registration = host.registerLinkProvider(() => ({}) as never);
    expect(seen.at(-1)).toBe('links');
    registration.dispose();
    expect(seen.at(-1)).toBe(null);
  });

  it('keeps what an extension drew when another one is registered', () => {
    const host = new SourceViewHost();
    host.registerExtension(drawPresence);
    const { view, parent } = setup('Some bold text\n', host);
    view.setPresence([{ id: '1', user: { name: 'Ann', color: '#b58900' }, anchor: 5, head: 9 }]);
    host.registerExtension(firstWord);
    expect(marked(parent, '.drawn')).toEqual(['bold']);
  });

  it('stops applying contributions to a destroyed view', () => {
    const host = new SourceViewHost();
    const made: string[] = [];
    host.registerExtension(({ document }) => {
      made.push(document.text);
      return [];
    });
    const { view } = setup('text\n', host);
    view.destroy();
    host.registerExtension(firstWord);
    expect(made).toEqual(['text\n']);
  });
});

describe('SourceView presence (a PresenceTarget without drawing of its own)', () => {
  it('draws nothing itself', () => {
    const { view, parent } = setup('Some bold text\n');
    view.setPresence([{ id: '1', user: { name: 'Ann', color: '#b58900' }, anchor: 5, head: 9 }]);
    expect(parent.querySelector('.typst-remote-caret, .typst-remote-selection')).toBeNull();
  });
});
