// @vitest-environment jsdom
// Tests for source-view.ts: other users' places drawn in the Source views.
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { SourceViewHost } from '../../../hosts/source-view/source-view';
import { ProjectPath } from '../../../core/paths/paths';
import { Presences, type Presence } from '../presence/presence';
import { sourcePresence } from './source-view';

const MAIN = ProjectPath.of('/main.typ');

/** A Source view of `text` with the presence contribution; `view.setPresence` reports the others' places in its file. */
function withPresence(text: string) {
  const doc = new TypstDocument(text);
  const presences = new Presences((document) => (document === doc ? MAIN : undefined));
  const host = new SourceViewHost();
  host.registerExtension(sourcePresence(presences));
  const parent = document.createElement('div');
  document.body.append(parent);
  host.createView(parent, doc);
  const view = { setPresence: (here: readonly Presence[]) => presences.set(here.map((presence) => ({ ...presence, path: MAIN }))) };
  return { doc, view, parent, presences };
}

const marked = (parent: HTMLElement, selector: string) =>
  [...parent.querySelectorAll(selector)].map((element) => element.textContent);

describe('presence in the Source view', () => {
  const ann = { id: '1', user: { name: 'Ann', color: '#b58900' } };
  /** The line text before each caret. */
  const carets = (parent: HTMLElement) =>
    [...parent.querySelectorAll<HTMLElement>('.cm-line .typst-remote-caret')].map((caret) => {
      const nodes = [...caret.closest('.cm-line')!.childNodes];
      return nodes.slice(0, nodes.indexOf(caret)).map((node) => node.textContent).join('');
    });

  it('draws a named caret at the position, also on an empty line', () => {
    const { view, parent } = withPresence('one\n\nthree\n');
    view.setPresence([{ ...ann, anchor: 4, head: 4 }]);
    const caret = parent.querySelector<HTMLElement>('.typst-remote-caret')!;
    expect(caret.dataset.user).toBe('Ann');
    expect(caret.closest('.cm-line')!.textContent).toBe('Ann');
    expect(caret.querySelector('.typst-remote-caret__flag')!.textContent).toBe('Ann');
    expect(caret.style.getPropertyValue('--typst-remote-color')).toBe('#b58900');
    view.setPresence([{ ...ann, anchor: 2, head: 2 }]);
    expect(carets(parent)).toEqual(['on']);
  });

  it('tints the selection and keeps it on its text through edits', () => {
    const { doc, view, parent } = withPresence('Some bold text\n');
    view.setPresence([{ ...ann, anchor: 5, head: 9 }]);
    expect(marked(parent, '.typst-remote-selection[data-user="Ann"]')).toEqual(['bold']);
    doc.change([{ from: 0, to: 0, insert: 'Really. ' }], 'visual');
    expect(marked(parent, '.typst-remote-selection')).toEqual(['bold']);
    expect(carets(parent)).toEqual(['Really. Some bold']);
    view.setPresence([]);
    expect(parent.querySelector('.typst-remote-caret, .typst-remote-selection')).toBeNull();
  });

  it('draws the places known when the view is made, and only those in its file', () => {
    const doc = new TypstDocument('Some bold text\n');
    const presences = new Presences((document) => (document === doc ? MAIN : undefined));
    presences.set([{ ...ann, anchor: 5, head: 9, path: MAIN }, { ...ann, id: '2', anchor: 0, head: 4, path: ProjectPath.of('/a.typ') }]);
    const host = new SourceViewHost();
    host.registerExtension(sourcePresence(presences));
    const parent = document.body.appendChild(document.createElement('div'));
    host.createView(parent, doc);
    expect(marked(parent, '.typst-remote-selection')).toEqual(['bold']);
  });

  it('redraws the caret (showing the name again) only when it moved', () => {
    const { view, parent } = withPresence('Some bold text\n');
    view.setPresence([{ ...ann, anchor: 2, head: 2 }]);
    const first = parent.querySelector('.typst-remote-caret');
    expect(first!.classList).toContain('typst-remote-caret--transient');
    view.setPresence([{ ...ann, anchor: 2, head: 2 }]);
    expect(parent.querySelector('.typst-remote-caret')).toBe(first);
    view.setPresence([{ ...ann, anchor: 3, head: 3 }]);
    expect(parent.querySelector('.typst-remote-caret')).not.toBe(first);
  });
});
