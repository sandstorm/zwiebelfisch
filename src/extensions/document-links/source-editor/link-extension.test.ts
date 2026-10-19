// @vitest-environment jsdom
// Tests for link-extension.ts: document links in a CodeMirror editor.
import { describe, expect, it, vi } from 'vitest';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { ProjectPath } from '../../../core/paths/paths';
import { SourceRange } from '../../../core/typst-document/typst-document';
import type { LinkActions } from '../followable-link';
import { linkExtension } from './link-extension';

const path = ProjectPath.of;

const TEXT = '#import "template.typ": template\n#include "missing.typ"\nText\n';
const CREATE = { title: 'Create missing.typ', command: 'test.create', arguments: ['/missing.typ'] };

/** Links on the two paths: the first resolves to its file, the second to a tooltip and a command. */
function setup(text = TEXT) {
  const linked: LinkActions = {
    provideDocumentLinks: ({ text }) =>
      ['template.typ', 'missing.typ'].flatMap((name) => {
        const from = text.indexOf(name);
        return from < 0 ? [] : [{ range: SourceRange.of({ from, to: from + name.length }) }];
      }),
    resolveDocumentLink: (link) =>
      text.slice(link.range.from, link.range.to) === 'template.typ'
        ? { ...link, target: path('/template.typ') }
        : { ...link, tooltip: 'missing.typ is not in the project', command: CREATE },
    open: vi.fn(),
    executeCommand: vi.fn(async () => undefined),
  };
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({ parent, doc: text, extensions: linkExtension(linked, 'typst', () => path('/main.typ')) });
  return { linked, parent, view };
}

function modClick(view: EditorView, pos: number, init: MouseEventInit = { ctrlKey: true }) {
  view.posAtCoords = () => pos;
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init });
  view.contentDOM.dispatchEvent(event);
  return event;
}

describe('linkExtension', () => {
  it('marks the links, also after edits', () => {
    const { parent, view } = setup();
    const marked = () => [...parent.querySelectorAll('.zwf-source__path')].map((m) => m.textContent);
    expect(marked()).toEqual(['template.typ', 'missing.typ']);
    view.dispatch({ changes: { from: TEXT.indexOf('#include'), to: TEXT.indexOf('Text') } });
    expect(marked()).toEqual(['template.typ']);
  });

  it('Mod+click on a link opens its target', () => {
    const { linked, view } = setup();
    const event = modClick(view, TEXT.indexOf('template') + 2);
    expect(linked.open).toHaveBeenCalledWith(path('/template.typ'), undefined);
    expect(event.defaultPrevented).toBe(true);
  });

  it('Mod+click on a link to a place goes there', () => {
    const { linked, view } = setup();
    const selection = SourceRange.of({ from: 3, to: 3 });
    linked.resolveDocumentLink = (link) => ({ ...link, target: path('/ch2.typ'), selection });
    modClick(view, TEXT.indexOf('missing'));
    expect(linked.open).toHaveBeenCalledWith(path('/ch2.typ'), selection);
  });

  it('leaves plain clicks, clicks elsewhere and links without a target to the editor', () => {
    const { linked, view } = setup();
    modClick(view, TEXT.indexOf('template'), {});
    modClick(view, TEXT.indexOf('Text'));
    modClick(view, TEXT.indexOf('missing'));
    expect(linked.open).not.toHaveBeenCalled();
  });

  it('Alt+Enter opens the target of the link that holds the cursor', () => {
    const { linked, view } = setup();
    view.dispatch({ selection: { anchor: TEXT.indexOf('template') + 4 } });
    expect(runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter', altKey: true }), 'editor')).toBe(true);
    expect(linked.open).toHaveBeenCalledWith(path('/template.typ'), undefined);
    view.dispatch({ selection: { anchor: TEXT.indexOf('Text') } });
    expect(runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter', altKey: true }), 'editor')).toBe(false);
  });

  it('hovered, a link shows the hint of every link; with Mod held the editor shows it as one; leaving ends both', () => {
    vi.useFakeTimers();
    const { parent, view } = setup();
    const mark = parent.querySelector('.zwf-source__path')!;
    mark.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ctrlKey: true, metaKey: true }));
    expect(view.dom.classList.contains('zwf-link--mod')).toBe(true);
    expect(mark.classList.contains('zwf-link--mod')).toBe(false); // CodeMirror owns the mark
    vi.advanceTimersByTime(300);
    const hint = document.querySelector('.zwf-link-hint[role=tooltip]')!;
    expect(hint.textContent).toMatch(/^Open template\.typ\(Ctrl\+click or Alt\+Enter\)$/);
    expect(view.dom.getAttribute('aria-describedby')).toBe(hint.id);
    expect(parent.querySelector('[title]')).toBeNull();
    view.contentDOM.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(300);
    expect(document.querySelector('.zwf-link-hint')).toBeNull();
    expect(view.dom.classList.contains('zwf-link--mod')).toBe(false);
    vi.useRealTimers();
  });

  it('has no links in a text that is in no file', () => {
    const { linked } = setup();
    const parent = document.body.appendChild(document.createElement('div'));
    new EditorView({ parent, doc: TEXT, extensions: linkExtension(linked, 'typst', () => null) });
    expect(parent.querySelector('.zwf-source__path')).toBeNull();
  });
});
