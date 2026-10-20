// @vitest-environment jsdom
// Tests for languages.ts (LanguagesHost): merging the links of the providers for a document's language, resolving them
// through their provider; the declared languages by ending; the help sheets by language; the drop edit of a dropped
// file; the paste edit providers by language and priority.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../core/paths/paths';
import { SourceOffset, SourceRange } from '../../core/typst-document/typst-document';
import { type DocumentLink, type DocumentLinkProvider, LanguagesHost } from './languages';

const document = { path: ProjectPath.of('/main.typ'), languageId: 'typst', text: 'aaaa bbbb cccc' };

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
    const links = new LanguagesHost();
    links.registerDocumentLinkProvider({}, provider('first', [[0, 4], [10, 14]]));
    links.registerDocumentLinkProvider({}, provider('second', [[2, 6], [5, 9]]));
    links.registerDocumentLinkProvider({}, provider('high', [[12, 13]]), { priority: 110 });
    expect(describeLinks(links.provideDocumentLinks(document))).toEqual(['first@0-4', 'second@5-9', 'high@12-13']);
  });

  it('asks only the providers whose selector matches the document: by language, any of a list, or all', () => {
    const links = new LanguagesHost();
    links.registerDocumentLinkProvider({ language: 'typst' }, provider('typst', [[0, 1]]));
    links.registerDocumentLinkProvider({ language: 'json' }, provider('json', [[2, 3]]));
    links.registerDocumentLinkProvider([{ language: 'markdown' }, { language: 'json' }], provider('either', [[4, 5]]));
    links.registerDocumentLinkProvider({}, provider('all', [[6, 7]]));
    expect(describeLinks(links.provideDocumentLinks(document))).toEqual(['typst@0-1', 'all@6-7']);
    expect(describeLinks(links.provideDocumentLinks({ ...document, languageId: 'json' }))).toEqual(['json@2-3', 'either@4-5', 'all@6-7']);
  });

  it('stops asking a provider once its registration is disposed', () => {
    const links = new LanguagesHost();
    const registration = links.registerDocumentLinkProvider({}, provider('only', [[0, 4]]));
    registration.dispose();
    expect(links.provideDocumentLinks(document)).toEqual([]);
  });

  it('resolves a link through the provider that gave it (again after resolving)', () => {
    const links = new LanguagesHost();
    links.registerDocumentLinkProvider({}, provider('plain', [[0, 4]]));
    links.registerDocumentLinkProvider({}, provider('resolving', [[5, 9]], (link) => ({ ...link, target: ProjectPath.of('/a.typ') })));
    const [plain, resolving] = links.provideDocumentLinks(document);
    expect(links.resolveDocumentLink(plain)).toBe(plain);
    const resolved = links.resolveDocumentLink(resolving);
    expect(resolved.target).toBe(ProjectPath.of('/a.typ'));
    expect(links.resolveDocumentLink(resolved).target).toBe(ProjectPath.of('/a.typ'));
  });

  it('names the language of a file by the longest declared ending, in any case; undefined without one', () => {
    const languages = new LanguagesHost();
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

  it('gives the help sheets registered for a language (no language: every file), until disposed', () => {
    const languages = new LanguagesHost();
    const sheet = (title: string) => ({ title, sections: [] });
    languages.registerHelpSheet({ language: 'typst' }, sheet('Typst'));
    const mermaid = languages.registerHelpSheet([{ language: 'mermaid' }], sheet('Mermaid'));
    languages.registerHelpSheet({}, sheet('Everywhere'));
    const titles = (languageId: string | undefined) => languages.getHelpSheets(languageId).map(({ title }) => title);
    expect(titles('typst')).toEqual(['Typst', 'Everywhere']);
    expect(titles('mermaid')).toEqual(['Mermaid', 'Everywhere']);
    expect(titles(undefined)).toEqual(['Everywhere']);
    mermaid.dispose();
    expect(titles('mermaid')).toEqual(['Everywhere']);
  });

  it('makes a dropped file into the edit of the first provider by priority that gives one (equal: registered first), for the document\'s language', () => {
    const languages = new LanguagesHost();
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

  it('uploads a file dropped from the computer to the folder of the first provider by priority that names one, else to the top', () => {
    const languages = new LanguagesHost();
    const none = { provideDocumentDropEdits: () => null };
    languages.registerDocumentDropEditProvider({ language: 'typst' }, none, { priority: 110 });
    languages.registerDocumentDropEditProvider({ language: 'typst' }, { ...none, provideUploadFolder: (_document, file) => (file.endsWith('.png') ? '/img/' : undefined) });
    expect(languages.provideUploadFolder(document, ProjectPath.of('/cat.png'))).toBe('/img/');
    expect(languages.provideUploadFolder(document, ProjectPath.of('/notes.txt'))).toBe('/');
  });

  it('gives the paste edit providers of a language by priority (higher first, default 100; equal: registration order)', () => {
    const languages = new LanguagesHost();
    const register = (selector: { language?: string }, name: string, priority?: number) =>
      languages.registerDocumentPasteEditProvider(selector, { provideDocumentPasteEdits: () => [{ kind: name, title: name, insertText: name }] }, { providedPasteEditKinds: [name] }, { priority });
    register({ language: 'typst' }, 'low', 0);
    register({}, 'a');
    register({ language: 'typst' }, 'high', 200);
    register({ language: 'json' }, 'json');
    const removed = register({ language: 'typst' }, 'removed');
    removed.dispose();
    expect(languages.getDocumentPasteEditProviders('typst').map(({ metadata }) => metadata.providedPasteEditKinds[0])).toEqual(['high', 'a', 'low']);
  });
});
