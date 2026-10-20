// @vitest-environment jsdom
// Tests for languages.ts (LanguagesHost): merging the links of the providers for a document's language, resolving them
// through their provider; the declared languages by ending; the help sheets by language; the drop edit of a dropped
// file; the paste edit providers.
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

  it('gives the paste edits of the providers of the language that read a type the clipboard has, of their declared kinds', () => {
    const languages = new LanguagesHost();
    const edit = (kind: string) => ({ kind, title: kind, insertText: kind });
    const offering = (...kinds: string[]) => ({ provideDocumentPasteEdits: () => kinds.map(edit) });
    languages.registerDocumentPasteEditProvider({ language: 'typst' }, offering('typst.markdown', 'typst.markdown.gfm', 'other'), { providedPasteEditKinds: ['typst.markdown'], pasteMimeTypes: ['text/*'] });
    languages.registerDocumentPasteEditProvider({ language: 'typst' }, offering('typst.word'), { providedPasteEditKinds: ['typst.word'], pasteMimeTypes: ['text/rtf'] });
    languages.registerDocumentPasteEditProvider({ language: 'typst' }, offering('typst.any'), { providedPasteEditKinds: ['typst.any'] });
    languages.registerDocumentPasteEditProvider({ language: 'typst' }, offering('resolving'), { providedPasteEditKinds: [] });
    languages.registerDocumentPasteEditProvider({ language: 'json' }, offering('json'), { providedPasteEditKinds: ['json'] });
    const data = { types: ['text/plain', 'text/html'] } as unknown as DataTransfer;
    const kinds = languages.provideDocumentPasteEdits(document, [SourceRange.of({ from: 0, to: 0 })], data).map(({ kind }) => kind);
    expect(kinds).toEqual(['typst.markdown', 'typst.markdown.gfm', 'typst.any']);
  });

  it('asks the paste edit providers by priority (higher first, default 100; equal: registration order), offering and resolving', () => {
    const languages = new LanguagesHost();
    const resolved: string[] = [];
    const provider = (kind: string) => ({
      provideDocumentPasteEdits: () => [{ kind, title: kind, insertText: kind }],
      resolveDocumentPasteEdit: () => void resolved.push(kind),
    });
    languages.registerDocumentPasteEditProvider({}, provider('typst'), { providedPasteEditKinds: ['typst'] }, { priority: 0 });
    languages.registerDocumentPasteEditProvider({}, provider('typst.a'), { providedPasteEditKinds: ['typst.a'] });
    languages.registerDocumentPasteEditProvider({}, provider('typst.b'), { providedPasteEditKinds: ['typst.b'] }, { priority: 200 });
    languages.registerDocumentPasteEditProvider({}, provider('typst.c'), { providedPasteEditKinds: ['typst.c'] });
    const data = { types: ['text/plain'] } as unknown as DataTransfer;
    const ranges = [SourceRange.of({ from: 0, to: 0 })];
    expect(languages.provideDocumentPasteEdits(document, ranges, data).map(({ kind }) => kind)).toEqual(['typst.b', 'typst.a', 'typst.c', 'typst']);
    languages.resolveDocumentPasteEdit({ kind: 'typst', title: 'Typst', insertText: '' }, document, ranges, data);
    expect(resolved).toEqual(['typst.b', 'typst.a', 'typst.c', 'typst']);
  });

  it('resolves the paste edit that goes in by every provider of the language in order, each given the one before; drops edits that collide', () => {
    const languages = new LanguagesHost();
    const change = (from: number, to: number, insert: string) => ({ from: SourceOffset.of(from), to: SourceOffset.of(to), insert });
    const prepared: string[] = [];
    languages.registerDocumentPasteEditProvider(
      { language: 'typst' },
      {
        prepareDocumentPaste: (_document, copied) => void prepared.push(copied),
        resolveDocumentPasteEdit: (edit) => ({ ...edit, insertText: edit.insertText.toUpperCase(), additionalEdit: [...(edit.additionalEdit ?? []), change(0, 0, 'top '), change(6, 7, 'x'), change(10, 12, 'cc')] }),
      },
      { providedPasteEditKinds: [] },
    );
    languages.registerDocumentPasteEditProvider(
      { language: 'typst' },
      { resolveDocumentPasteEdit: (edit) => ({ ...edit, insertText: `${edit.insertText}!`, additionalEdit: [...(edit.additionalEdit ?? []), change(11, 13, 'CC'), change(14, 14, 'end')] }) },
      { providedPasteEditKinds: [] },
    );
    languages.registerDocumentPasteEditProvider({ language: 'json' }, { resolveDocumentPasteEdit: (edit) => ({ ...edit, insertText: 'json' }) }, { providedPasteEditKinds: [] });
    const data = {} as DataTransfer;
    languages.prepareDocumentPaste(document, 'bb', data);
    expect(prepared).toEqual(['bb']);
    // pasted over `bbbb` (5..9): an edit inside it (6..7) and one overlapping an earlier one (11..13) are dropped
    const ranges = [SourceRange.of({ from: 5, to: 9 })];
    const edit = { kind: 'typst', title: 'Typst', insertText: 'pasted' };
    expect(languages.resolveDocumentPasteEdit(edit, document, ranges, data)).toEqual({ ...edit, insertText: 'PASTED!', additionalEdit: [change(0, 0, 'top '), change(10, 12, 'cc'), change(14, 14, 'end')] });
  });
});
