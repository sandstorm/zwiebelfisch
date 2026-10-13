// @vitest-environment jsdom
// Tests for link-extension.ts: document links in a CodeMirror editor.
import { describe, expect, it, vi } from 'vitest';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { ProjectPath } from '../../core/paths/paths';
import type { DocumentLink } from './languages';
import { linkExtension, linkInfo, type LinkActions } from './link-extension';
import { SourceRange } from '../../core/typst-document/typst-document';

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

describe('linkInfo (the hover)', () => {
  const link: DocumentLink = { range: SourceRange.of({ from: 0, to: 1 }) };

  const actions = () => ({ open: vi.fn(), executeCommand: vi.fn(async (): Promise<unknown> => undefined) });

  it('offers to open the target', () => {
    const { open, executeCommand } = actions();
    const dom = linkInfo(document, { ...link, target: path('/template.typ') }, { open, executeCommand })!;
    expect(dom.textContent).toMatch(/Open template\.typ/);
    expect(dom.textContent).toMatch(/Ctrl\+click/);
    dom.querySelector('button')!.click();
    expect(open).toHaveBeenCalledWith(path('/template.typ'), undefined);
  });

  it('offers to go to a place in the target file, or to open a URL', () => {
    const { open, executeCommand } = actions();
    const selection = SourceRange.of({ from: 40, to: 40 });
    const dom = linkInfo(document, { ...link, target: path('/ch2.typ'), selection, tooltip: 'Go to Figure · Setup in ch2.typ' }, { open, executeCommand })!;
    expect(dom.querySelector('button')!.textContent).toBe('Go to Figure · Setup in ch2.typ');
    dom.querySelector('button')!.click();
    expect(open).toHaveBeenCalledWith(path('/ch2.typ'), selection);
    const url = new URL('https://typst.app/');
    linkInfo(document, { ...link, target: url }, { open, executeCommand })!.querySelector('button')!.click();
    expect(open).toHaveBeenLastCalledWith(url, undefined);
  });

  it('offers to open the target as its tooltip says, if it has one', () => {
    const dom = linkInfo(document, { ...link, target: path('/flow.drawio.png'), tooltip: 'Edit diagram' }, actions())!;
    expect(dom.querySelector('button')!.textContent).toBe('Edit diagram');
    expect(dom.textContent).toBe('Edit diagram(Ctrl+click or Alt+Enter)');
  });

  it("shows the tooltip and runs the command with its arguments, showing why it failed", async () => {
    const { open, executeCommand } = actions();
    executeCommand.mockRejectedValueOnce(new Error('This change is not allowed here.'));
    const dom = linkInfo(document, { ...link, tooltip: 'missing.typ is not in the project', command: CREATE }, { open, executeCommand })!;
    expect(dom.textContent).toContain('missing.typ is not in the project');
    const create = dom.querySelector('button')!;
    expect(create.textContent).toBe('Create missing.typ');
    create.click();
    expect(executeCommand).toHaveBeenCalledWith('test.create', '/missing.typ');
    await vi.waitFor(() => expect(dom.textContent).toContain('This change is not allowed here.'));
  });

  it('is nothing for a link that offers nothing', () => {
    expect(linkInfo(document, link, actions())).toBeNull();
  });
});
