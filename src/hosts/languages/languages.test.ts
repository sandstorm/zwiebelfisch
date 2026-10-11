// Tests for languages.ts (LanguagesHost): merging the links of the providers for a document's language, resolving them
// through their provider; a document's primary link and the link at an offset; the declared languages by ending; the
// help sheets by language; the drop edit of a dropped file; the paste edit providers.
import { describe, expect, it, vi } from 'vitest';
import { ProjectPath } from '../../core/paths/paths';
import { SourceOffset, SourceRange } from '../../core/typst-document/typst-document';
import { type DocumentLink, type DocumentLinkProvider, LanguagesHost } from './languages';

const document = { path: ProjectPath.of('/main.typ'), languageId: 'typst', text: 'aaaa bbbb cccc' };
const targets = { open() {}, executeCommand: async () => undefined };

/** Links at the given ranges, each with `tooltip: name`. */
function provider(name: string, ranges: [number, number][], resolve?: DocumentLinkProvider['resolveDocumentLink']): DocumentLinkProvider {
  return {
    provideDocumentLinks: () => ranges.map(([from, to]) => ({ range: SourceRange.of({ from, to }), tooltip: name })),
    resolveDocumentLink: resolve,
  };
}

const describeLinks = (links: readonly DocumentLink[]) => links.map(({ range, tooltip }) => `${tooltip}@${range.from}-${range.to}`);

describe('LanguagesHost', () => {
  it("merges the providers' links in text order; of overlapping ones the higher priority's wins (equal: registered first)", () => {
    const links = new LanguagesHost(targets);
    links.registerDocumentLinkProvider({}, provider('first', [[0, 4], [10, 14]]));
    links.registerDocumentLinkProvider({}, provider('second', [[2, 6], [5, 9]]));
    links.registerDocumentLinkProvider({}, provider('high', [[12, 13]]), { priority: 110 });
    expect(describeLinks(links.provideDocumentLinks(document))).toEqual(['first@0-4', 'second@5-9', 'high@12-13']);
  });

  it('asks only the providers whose selector matches the document: by language, any of a list, or all', () => {
    const links = new LanguagesHost(targets);
    links.registerDocumentLinkProvider({ language: 'typst' }, provider('typst', [[0, 1]]));
    links.registerDocumentLinkProvider({ language: 'json' }, provider('json', [[2, 3]]));
    links.registerDocumentLinkProvider([{ language: 'markdown' }, { language: 'json' }], provider('either', [[4, 5]]));
    links.registerDocumentLinkProvider({}, provider('all', [[6, 7]]));
    expect(describeLinks(links.provideDocumentLinks(document))).toEqual(['typst@0-1', 'all@6-7']);
    expect(describeLinks(links.provideDocumentLinks({ ...document, languageId: 'json' }))).toEqual(['json@2-3', 'either@4-5', 'all@6-7']);
  });

  it('stops asking a provider once its registration is disposed', () => {
    const links = new LanguagesHost(targets);
    const registration = links.registerDocumentLinkProvider({}, provider('only', [[0, 4]]));
    registration.dispose();
    expect(links.provideDocumentLinks(document)).toEqual([]);
  });

  it('resolves a link through the provider that gave it (again after resolving)', () => {
    const links = new LanguagesHost(targets);
    links.registerDocumentLinkProvider({}, provider('plain', [[0, 4]]));
    links.registerDocumentLinkProvider({}, provider('resolving', [[5, 9]], (link) => ({ ...link, target: ProjectPath.of('/a.typ') })));
    const [plain, resolving] = links.provideDocumentLinks(document);
    expect(links.resolveDocumentLink(plain)).toBe(plain);
    const resolved = links.resolveDocumentLink(resolving);
    expect(resolved.target).toBe(ProjectPath.of('/a.typ'));
    expect(links.resolveDocumentLink(resolved).target).toBe(ProjectPath.of('/a.typ'));
  });

  it('gives the primary link of a document: the first leading somewhere, titled as the hover offers it, opening it', () => {
    const open = vi.fn();
    const links = new LanguagesHost({ ...targets, open });
    const to = (file: string) => (link: DocumentLink) => ({ ...link, target: ProjectPath.of(file) });
    links.registerDocumentLinkProvider({}, provider('nowhere', [[0, 4]]));
    links.registerDocumentLinkProvider({}, { provideDocumentLinks: () => [{ range: SourceRange.of({ from: 5, to: 9 }) }], resolveDocumentLink: to('/flow.drawio.png') });
    links.registerDocumentLinkProvider({}, provider('Edit diagram', [[10, 14]], to('/b.mmd')));
    const primary = links.primaryLink(document)!;
    expect(primary.title).toMatch(/^Open flow\.drawio\.png \((⌘|Ctrl)\+click or Alt\+Enter\)$/);
    expect(primary.isFollowEvent({ ctrlKey: true, metaKey: true } as MouseEvent)).toBe(true);
    expect(primary.isFollowEvent({ ctrlKey: false, metaKey: false } as MouseEvent)).toBe(false);
    primary.follow();
    expect(open).toHaveBeenCalledWith(ProjectPath.of('/flow.drawio.png'), undefined);
    const tooltipped = new LanguagesHost(targets);
    tooltipped.registerDocumentLinkProvider({}, provider('Edit diagram', [[10, 14]], to('/b.mmd')));
    expect(tooltipped.primaryLink(document)?.title).toMatch(/^Edit diagram \(/);
    expect(new LanguagesHost(targets).primaryLink(document)).toBeNull();
  });

  it('gives the link at an offset (both ends included) that leads somewhere, resolved anew each time, following it to its selection', () => {
    const open = vi.fn();
    const links = new LanguagesHost({ ...targets, open });
    let at = 3;
    const provide = vi.fn(() => [{ range: SourceRange.of({ from: 5, to: 9 }) }, { range: SourceRange.of({ from: 10, to: 14 }) }]);
    const resolve = vi.fn((link: DocumentLink) =>
      link.range.from === 5 ? { ...link, target: ProjectPath.of('/ch2.typ'), selection: SourceRange.of({ from: at, to: at }), tooltip: 'Go to Figure · Setup' } : link,
    );
    links.registerDocumentLinkProvider({}, { provideDocumentLinks: provide, resolveDocumentLink: resolve });
    expect(links.linkAt(document, SourceOffset.of(4))).toBeNull();
    expect(links.linkAt(document, SourceOffset.of(12))).toBeNull(); // leads nowhere
    const link = links.linkAt(document, SourceOffset.of(9))!;
    expect(link.title).toMatch(/^Go to Figure · Setup \((⌘|Ctrl)\+click or Alt\+Enter\)$/);
    at = 7; // the label moved since
    link.follow();
    expect(open).toHaveBeenCalledWith(ProjectPath.of('/ch2.typ'), { from: 7, to: 7 });
    expect(links.linkAt(document, SourceOffset.of(5))).not.toBeNull();
    expect(provide).toHaveBeenCalledTimes(1); // the same text: its links are kept
    links.linkAt({ ...document, text: 'aaaa bbbb cccc!' }, SourceOffset.of(5));
    expect(provide).toHaveBeenCalledTimes(2);
  });

  it('titles a link to a URL by its address and opens it', () => {
    const open = vi.fn();
    const links = new LanguagesHost({ ...targets, open });
    const url = new URL('https://typst.app/docs');
    links.registerDocumentLinkProvider({}, { provideDocumentLinks: () => [{ range: SourceRange.of({ from: 0, to: 4 }), target: url }] });
    const link = links.linkAt(document, SourceOffset.of(2))!;
    expect(link.title).toMatch(/^Open https:\/\/typst\.app\/docs \(/);
    link.follow();
    expect(open).toHaveBeenCalledWith(url, undefined);
  });

  it('names the language of a file by the longest declared ending, in any case; undefined without one', () => {
    const languages = new LanguagesHost(targets);
    languages.declare([{ id: 'typst', extensions: ['.typ'] }]);
    languages.declare([
      { id: 'generated', extensions: ['.gen.typ'] },
      { id: 'yaml', extensions: ['.yaml', '.YML'] },
    ]);
    expect(languages.getLanguageId(ProjectPath.of('/a/main.TYP'))).toBe('typst');
    expect(languages.getLanguageId(ProjectPath.of('/t.ic.gen.typ'))).toBe('generated');
    expect(languages.getLanguageId(ProjectPath.of('/conf.yml'))).toBe('yaml');
    expect(languages.getLanguageId(ProjectPath.of('/logo.png'))).toBeUndefined();
    expect(() => languages.declare([{ id: 'other', extensions: ['.typ'] }])).toThrow(/\.typ are typst/);
  });

  it('gives the help sheets of the providers for a language (no language: every file), until disposed', () => {
    const languages = new LanguagesHost(targets);
    const sheet = (title: string) => ({ provideHelp: () => ({ title, sections: [] }) });
    languages.registerHelpProvider({ language: 'typst' }, sheet('Typst'));
    const mermaid = languages.registerHelpProvider([{ language: 'mermaid' }], sheet('Mermaid'));
    languages.registerHelpProvider({}, sheet('Everywhere'));
    const titles = (languageId: string | undefined) => languages.provideHelp(languageId).map(({ title }) => title);
    expect(titles('typst')).toEqual(['Typst', 'Everywhere']);
    expect(titles('mermaid')).toEqual(['Mermaid', 'Everywhere']);
    expect(titles(undefined)).toEqual(['Everywhere']);
    mermaid.dispose();
    expect(titles('mermaid')).toEqual(['Everywhere']);
  });

  it('makes a dropped file into the edit of the first provider by priority that gives one (equal: registered first), for the document\'s language', () => {
    const languages = new LanguagesHost(targets);
    const drops = (name: string, ending: string) => ({
      provideDocumentDropEdits: (_document: unknown, _position: unknown, file: ProjectPath) => (file.endsWith(ending) ? { insertText: name } : null),
    });
    languages.registerDocumentDropEditProvider({ language: 'typst' }, drops('image', '.png'));
    languages.registerDocumentDropEditProvider({ language: 'typst' }, drops('any png', '.png'));
    const diagram = languages.registerDocumentDropEditProvider({ language: 'typst' }, drops('diagram', '.drawio.png'), { priority: 110 });
    languages.registerDocumentDropEditProvider({ language: 'json' }, drops('json', '.png'), { priority: 200 });
    const edit = (file: string) => languages.provideDocumentDropEdit(document, SourceOffset.of(0), ProjectPath.of(file))?.insertText;
    expect(edit('/flow.drawio.png')).toBe('diagram');
    expect(edit('/logo.png')).toBe('image');
    expect(edit('/notes.txt')).toBeUndefined();
    diagram.dispose();
    expect(edit('/flow.drawio.png')).toBe('image');
  });

  it('runs the paste edit providers of the language in order, each on the text the one before left; drops edits that collide', () => {
    const languages = new LanguagesHost(targets);
    const change = (from: number, to: number, insert: string) => ({ from: SourceOffset.of(from), to: SourceOffset.of(to), insert });
    const prepared: string[] = [];
    languages.registerDocumentPasteEditProvider({ language: 'typst' }, {
      prepareDocumentPaste: (_document, copied) => void prepared.push(copied),
      provideDocumentPasteEdits: (_document, _ranges, text) => ({ insertText: text.toUpperCase(), additionalEdits: [change(0, 0, 'top '), change(6, 7, 'x'), change(10, 12, 'cc')] }),
    });
    languages.registerDocumentPasteEditProvider({ language: 'typst' }, {
      provideDocumentPasteEdits: (_document, _ranges, text) => ({ insertText: `${text}!`, additionalEdits: [change(11, 13, 'CC'), change(14, 14, 'end')] }),
    });
    languages.registerDocumentPasteEditProvider({ language: 'json' }, { provideDocumentPasteEdits: () => ({ insertText: 'json' }) });
    const data = {} as DataTransfer;
    languages.prepareDocumentPaste(document, 'bb', data);
    expect(prepared).toEqual(['bb']);
    // pasted over `bbbb` (5..9): an edit inside it (6..7) and one overlapping an earlier one (11..13) are dropped
    const ranges = [SourceRange.of({ from: 5, to: 9 })];
    expect(languages.provideDocumentPasteEdits(document, ranges, 'pasted', data)).toEqual({ insertText: 'PASTED!', additionalEdits: [change(0, 0, 'top '), change(10, 12, 'cc'), change(14, 14, 'end')] });
  });
});
