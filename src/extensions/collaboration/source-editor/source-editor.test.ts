// @vitest-environment jsdom
// Tests for source-editor.ts: other users' places drawn in the Source editors.
import { describe, expect, it } from 'vitest';
import { SourceOffset, TypstDocument } from '../../../core/typst-document/typst-document';
import { SourceEditorHost } from '../../../hosts/source-editor/source-editor';
import { ProjectPath } from '../../../core/paths/paths';
import { Presences, type Presence } from '../presence/presence';
import { sourcePresence } from './source-editor';

const MAIN = ProjectPath.of('/main.typ');

/** A Source editor of `text` with the presence contribution; `view.setPresence` reports the others' places in its file. */
function withPresence(text: string) {
  const doc = new TypstDocument(text);
  const presences = new Presences((document) => (document === doc ? MAIN : undefined));
  const host = new SourceEditorHost();
  host.registerCodeMirrorExtension(sourcePresence(presences));
  const parent = document.createElement('div');
  document.body.append(parent);
  host.createEditor(parent, doc);
  const view = { setPresence: (here: readonly Presence[]) => presences.set(here.map((presence) => ({ ...presence, path: MAIN, anchor: SourceOffset.of(presence.anchor), head: SourceOffset.of(presence.head) }))) };
  return { doc, view, parent, presences };
}

const marked = (parent: HTMLElement, selector: string) =>
  [...parent.querySelectorAll(selector)].map((element) => element.textContent);

describe('presence in the Source editor', () => {
  const ann = { id: '1', user: { name: 'Ann', color: '#b58900' } };
  /** The line text before each caret. */
  const carets = (parent: HTMLElement) =>
    [...parent.querySelectorAll<HTMLElement>('.cm-line .typst-collaboration__caret')].map((caret) => {
      const nodes = [...caret.closest('.cm-line')!.childNodes];
      return nodes.slice(0, nodes.indexOf(caret)).map((node) => node.textContent).join('');
    });

  it('draws a named caret at the position, also on an empty line', () => {
    const { view, parent } = withPresence('one\n\nthree\n');
    view.setPresence([{ ...ann, anchor: 4, head: 4 }]);
    const caret = parent.querySelector<HTMLElement>('.typst-collaboration__caret')!;
    expect(caret.dataset.user).toBe('Ann');
    expect(caret.closest('.cm-line')!.textContent).toBe('Ann');
    expect(caret.querySelector('.typst-collaboration__caret-flag')!.textContent).toBe('Ann');
    expect(caret.style.getPropertyValue('--typst-remote-color')).toBe('#b58900');
    view.setPresence([{ ...ann, anchor: 2, head: 2 }]);
    expect(carets(parent)).toEqual(['on']);
  });

  it('tints the selection and keeps it on its text through edits', () => {
    const { doc, view, parent } = withPresence('Some bold text\n');
    view.setPresence([{ ...ann, anchor: 5, head: 9 }]);
    expect(marked(parent, '.typst-collaboration__selection[data-user="Ann"]')).toEqual(['bold']);
    doc.change([{ from: SourceOffset.of(0), to: SourceOffset.of(0), insert: 'Really. ' }], 'visual');
    expect(marked(parent, '.typst-collaboration__selection')).toEqual(['bold']);
    expect(carets(parent)).toEqual(['Really. Some bold']);
    view.setPresence([]);
    expect(parent.querySelector('.typst-collaboration__caret, .typst-collaboration__selection')).toBeNull();
  });

  it('draws the places known when the view is made, and only those in its file', () => {
    const doc = new TypstDocument('Some bold text\n');
    const presences = new Presences((document) => (document === doc ? MAIN : undefined));
    presences.set([{ ...ann, anchor: SourceOffset.of(5), head: SourceOffset.of(9), path: MAIN }, { ...ann, id: '2', anchor: SourceOffset.of(0), head: SourceOffset.of(4), path: ProjectPath.of('/a.typ') }]);
    const host = new SourceEditorHost();
    host.registerCodeMirrorExtension(sourcePresence(presences));
    const parent = document.body.appendChild(document.createElement('div'));
    host.createEditor(parent, doc);
    expect(marked(parent, '.typst-collaboration__selection')).toEqual(['bold']);
  });

  it('redraws the caret (showing the name again) only when it moved', () => {
    const { view, parent } = withPresence('Some bold text\n');
    view.setPresence([{ ...ann, anchor: 2, head: 2 }]);
    const first = parent.querySelector('.typst-collaboration__caret');
    expect(first!.classList).toContain('typst-collaboration__caret--transient');
    view.setPresence([{ ...ann, anchor: 2, head: 2 }]);
    expect(parent.querySelector('.typst-collaboration__caret')).toBe(first);
    view.setPresence([{ ...ann, anchor: 3, head: 3 }]);
    expect(parent.querySelector('.typst-collaboration__caret')).not.toBe(first);
  });
});
