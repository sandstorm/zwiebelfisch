// @vitest-environment jsdom
// Tests for source-view.ts (file links).
import { describe, expect, it, vi } from 'vitest';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { DocumentLinkProvider, type LinkWorkspace } from '../../../core/document-links/document-links';
import { SourceViewHost } from '../../../hosts/source-view/source-view';
import { typst_lezer } from 'codemirror-lang-typst/lezer';
import { fileLinks, linkInfo } from './source-view';
import { PathReference, ProjectPath } from '../../../core/paths/paths';

const path = ProjectPath.of;
const ref = PathReference.of;

const TEXT = '#import "template.typ": template\n#include "missing.typ"\n#image("gone.png")\nText\n';

function setup(text = TEXT) {
  const files = new Set(['/main.typ', path('/template.typ')]);
  const links: LinkWorkspace = {
    resolve: (reference) => ProjectPath.resolve(path('/main.typ'), reference),
    exists: (path) => files.has(path),
    open: vi.fn(),
    create: vi.fn(async () => null),
  };
  const parent = document.createElement('div');
  document.body.append(parent);
  const host = new SourceViewHost();
  host.registerExtension(typst_lezer().language.extension);
  host.registerExtension(fileLinks);
  host.registerLinkProvider(() => new DocumentLinkProvider(links));
  const source = host.createView(parent, new TypstDocument(text));
  const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>('.cm-editor')!)!;
  return { links, parent, source, view };
}

function modClick(view: EditorView, pos: number, init: MouseEventInit = { ctrlKey: true }) {
  view.posAtCoords = () => pos;
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init });
  view.contentDOM.dispatchEvent(event);
  return event;
}

describe('file links in the Source view', () => {
  it('marks the paths of imports, includes and file calls', () => {
    const { parent } = setup();
    const marked = [...parent.querySelectorAll('.typst-source__path')].map((m) => m.textContent);
    expect(marked).toEqual(['template.typ', 'missing.typ', 'gone.png']);
  });

  it('Mod+click on a path opens the file', () => {
    const { links, view } = setup();
    const event = modClick(view, TEXT.indexOf('template') + 2);
    expect(links.open).toHaveBeenCalledWith(path('/template.typ'));
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves plain clicks, clicks elsewhere and missing files to the editor', () => {
    const { links, view } = setup();
    modClick(view, TEXT.indexOf('template'), {});
    modClick(view, TEXT.indexOf('Text'));
    modClick(view, TEXT.indexOf('missing'));
    expect(links.open).not.toHaveBeenCalled();
  });

  it('Alt+Enter opens the file whose path holds the cursor', () => {
    const { links, view } = setup();
    view.dispatch({ selection: { anchor: TEXT.indexOf('template') + 4 } });
    const handled = runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter', altKey: true }), 'editor');
    expect(handled).toBe(true);
    expect(links.open).toHaveBeenCalledWith(path('/template.typ'));
    view.dispatch({ selection: { anchor: TEXT.indexOf('Text') } });
    expect(runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter', altKey: true }), 'editor')).toBe(false);
  });
});

describe('linkInfo (the hover tooltip)', () => {
  it('offers to open an existing file', () => {
    const { links } = setup();
    const dom = linkInfo(document, new DocumentLinkProvider(links), ref('template.typ'))!;
    expect(dom.textContent).toMatch(/Open template\.typ/);
    expect(dom.textContent).toMatch(/Ctrl\+click/);
    dom.querySelector('button')!.click();
    expect(links.open).toHaveBeenCalledWith(path('/template.typ'));
  });

  it('says a file is missing and offers to create a missing .typ file', async () => {
    const { links } = setup();
    const dom = linkInfo(document, new DocumentLinkProvider(links), ref('missing.typ'))!;
    expect(dom.textContent).toContain('missing.typ is not in the project');
    const create = dom.querySelector('button')!;
    expect(create.textContent).toBe('Create missing.typ');
    create.click();
    expect(links.create).toHaveBeenCalledWith(path('/missing.typ'));
    expect(linkInfo(document, new DocumentLinkProvider(links), ref('gone.png'))!.querySelector('button')).toBeNull();
    expect(linkInfo(document, new DocumentLinkProvider(links), ref('../up.typ'))).toBeNull();
  });

  it('shows why creating failed', async () => {
    const { links } = setup();
    vi.mocked(links.create).mockResolvedValueOnce('This change is not allowed here.');
    const dom = linkInfo(document, new DocumentLinkProvider(links), ref('missing.typ'))!;
    dom.querySelector('button')!.click();
    await vi.waitFor(() => expect(dom.textContent).toContain('This change is not allowed here.'));
  });
});
