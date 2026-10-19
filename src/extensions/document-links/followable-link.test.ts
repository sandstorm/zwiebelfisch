// @vitest-environment jsdom
// Tests for followable-link.ts: a document's primary link, the link at an offset, followed and hinted outside
// CodeMirror; what a link's hint offers.
import { describe, expect, it, vi } from 'vitest';
import { ProjectPath } from '../../core/paths/paths';
import { SourceOffset, SourceRange } from '../../core/typst-document/typst-document';
import { type DocumentLink, type DocumentLinkProvider, LanguagesHost } from '../../hosts/languages/languages';
import { type FollowableLink, linkFinder, linkInfo, primaryLink } from './followable-link';

const path = ProjectPath.of;
const document = { path: path('/main.typ'), languageId: 'typst', text: 'aaaa bbbb cccc' };
const CREATE = { title: 'Create missing.typ', command: 'test.create', arguments: ['/missing.typ'] };

/** The providers' links (registered on `links`) as the extension follows them: opening with `open`. */
function setup() {
  const links = new LanguagesHost();
  const open = vi.fn();
  const actions = {
    provideDocumentLinks: (text: typeof document) => links.provideDocumentLinks(text),
    resolveDocumentLink: (link: DocumentLink) => links.resolveDocumentLink(link),
    open,
    executeCommand: async () => undefined,
  };
  return { links, open, actions };
}

/** Links at the given ranges, each with `tooltip: name`. */
function provider(name: string, ranges: [number, number][], resolve?: DocumentLinkProvider['resolveDocumentLink']): DocumentLinkProvider {
  return {
    provideDocumentLinks: () => ranges.map(([from, to]) => ({ range: SourceRange.of({ from, to }), tooltip: name })),
    resolveDocumentLink: resolve,
  };
}

/** What `link`'s hint says when it is hovered (after the hover delay); it goes when the pointer leaves. */
function hintOf(link: FollowableLink): string {
  vi.useFakeTimers();
  const page = globalThis.document;
  const element = page.body.appendChild(page.createElement('span'));
  link.hover(new MouseEvent('mousemove'), element);
  vi.advanceTimersByTime(300);
  const text = page.querySelector('.zwf-link-hint')?.textContent ?? '';
  link.leave(new MouseEvent('mouseleave'));
  vi.advanceTimersByTime(300);
  element.remove();
  vi.useRealTimers();
  return text;
}

describe('primaryLink and linkFinder', () => {
  it('gives the primary link of a document: the first leading somewhere, hinted as the hover offers it, opening it', () => {
    const { links, open, actions } = setup();
    const to = (file: string) => (link: DocumentLink) => ({ ...link, target: ProjectPath.of(file) });
    links.registerDocumentLinkProvider({}, provider('nowhere', [[0, 4]]));
    links.registerDocumentLinkProvider({}, { provideDocumentLinks: () => [{ range: SourceRange.of({ from: 5, to: 9 }) }], resolveDocumentLink: to('/flow.drawio.png') });
    links.registerDocumentLinkProvider({}, provider('Edit diagram', [[10, 14]], to('/b.mmd')));
    const primary = primaryLink(document, actions)!;
    expect(hintOf(primary)).toMatch(/^Open flow\.drawio\.png\((⌘|Ctrl)\+click or Alt\+Enter\)$/);
    expect(primary.isFollowEvent({ ctrlKey: true, metaKey: true } as MouseEvent)).toBe(true);
    expect(primary.isFollowEvent({ ctrlKey: false, metaKey: false } as MouseEvent)).toBe(false);
    primary.follow();
    expect(open).toHaveBeenCalledWith(ProjectPath.of('/flow.drawio.png'), undefined);
    const tooltipped = setup();
    tooltipped.links.registerDocumentLinkProvider({}, provider('Edit diagram', [[10, 14]], to('/b.mmd')));
    expect(hintOf(primaryLink(document, tooltipped.actions)!)).toMatch(/^Edit diagram\(/);
    expect(primaryLink(document, setup().actions)).toBeNull();
  });

  it('finds the link at an offset (both ends included) that leads somewhere, resolved anew each time, following it to its selection', () => {
    const { links, open, actions } = setup();
    const linkAt = linkFinder(actions);
    let at = 3;
    const provide = vi.fn(() => [{ range: SourceRange.of({ from: 5, to: 9 }) }, { range: SourceRange.of({ from: 10, to: 14 }) }]);
    const resolve = vi.fn((link: DocumentLink) =>
      link.range.from === 5 ? { ...link, target: ProjectPath.of('/ch2.typ'), selection: SourceRange.of({ from: at, to: at }), tooltip: 'Go to Figure · Setup' } : link,
    );
    links.registerDocumentLinkProvider({}, { provideDocumentLinks: provide, resolveDocumentLink: resolve });
    expect(linkAt(document, SourceOffset.of(4))).toBeNull();
    expect(linkAt(document, SourceOffset.of(12))).toBeNull(); // leads nowhere
    const link = linkAt(document, SourceOffset.of(9))!;
    expect(hintOf(link)).toMatch(/^Go to Figure · Setup\((⌘|Ctrl)\+click or Alt\+Enter\)$/);
    at = 7; // the label moved since
    link.follow();
    expect(open).toHaveBeenCalledWith(ProjectPath.of('/ch2.typ'), { from: 7, to: 7 });
    expect(linkAt(document, SourceOffset.of(5))).not.toBeNull();
    expect(provide).toHaveBeenCalledTimes(1); // the same text: its links are kept
    linkAt({ ...document, text: 'aaaa bbbb cccc!' }, SourceOffset.of(5));
    expect(provide).toHaveBeenCalledTimes(2);
  });

  it('hints a link to a URL by its address and opens it', () => {
    const { links, open, actions } = setup();
    const linkAt = linkFinder(actions);
    const url = new URL('https://typst.app/docs');
    links.registerDocumentLinkProvider({}, { provideDocumentLinks: () => [{ range: SourceRange.of({ from: 0, to: 4 }), target: url }] });
    const link = linkAt(document, SourceOffset.of(2))!;
    expect(hintOf(link)).toMatch(/^Open https:\/\/typst\.app\/docs\(/);
    link.follow();
    expect(open).toHaveBeenCalledWith(url, undefined);
  });
});

describe('linkInfo (the hover)', () => {
  const link: DocumentLink = { range: SourceRange.of({ from: 0, to: 1 }) };

  const actions = () => ({ open: vi.fn(), executeCommand: vi.fn(async (): Promise<unknown> => undefined) });

  it('offers to open the target', () => {
    const { open, executeCommand } = actions();
    const dom = linkInfo(globalThis.document, { ...link, target: path('/template.typ') }, { open, executeCommand })!;
    expect(dom.textContent).toMatch(/Open template\.typ/);
    expect(dom.textContent).toMatch(/Ctrl\+click/);
    dom.querySelector('button')!.click();
    expect(open).toHaveBeenCalledWith(path('/template.typ'), undefined);
  });

  it('offers to go to a place in the target file, or to open a URL', () => {
    const { open, executeCommand } = actions();
    const selection = SourceRange.of({ from: 40, to: 40 });
    const dom = linkInfo(globalThis.document, { ...link, target: path('/ch2.typ'), selection, tooltip: 'Go to Figure · Setup in ch2.typ' }, { open, executeCommand })!;
    expect(dom.querySelector('button')!.textContent).toBe('Go to Figure · Setup in ch2.typ');
    dom.querySelector('button')!.click();
    expect(open).toHaveBeenCalledWith(path('/ch2.typ'), selection);
    const url = new URL('https://typst.app/');
    linkInfo(globalThis.document, { ...link, target: url }, { open, executeCommand })!.querySelector('button')!.click();
    expect(open).toHaveBeenLastCalledWith(url, undefined);
  });

  it('offers to open the target as its tooltip says, if it has one', () => {
    const dom = linkInfo(globalThis.document, { ...link, target: path('/flow.drawio.png'), tooltip: 'Edit diagram' }, actions())!;
    expect(dom.querySelector('button')!.textContent).toBe('Edit diagram');
    expect(dom.textContent).toBe('Edit diagram(Ctrl+click or Alt+Enter)');
  });

  it("shows the tooltip and runs the command with its arguments, showing why it failed", async () => {
    const { open, executeCommand } = actions();
    executeCommand.mockRejectedValueOnce(new Error('This change is not allowed here.'));
    const dom = linkInfo(globalThis.document, { ...link, tooltip: 'missing.typ is not in the project', command: CREATE }, { open, executeCommand })!;
    expect(dom.textContent).toContain('missing.typ is not in the project');
    const create = dom.querySelector('button')!;
    expect(create.textContent).toBe('Create missing.typ');
    create.click();
    expect(executeCommand).toHaveBeenCalledWith('test.create', '/missing.typ');
    await vi.waitFor(() => expect(dom.textContent).toContain('This change is not allowed here.'));
  });

  it('is nothing for a link that offers nothing', () => {
    expect(linkInfo(globalThis.document, link, actions())).toBeNull();
  });
});
