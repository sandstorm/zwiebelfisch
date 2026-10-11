// Tests for languages.ts (LanguagesHost): merging the providers' links, resolving them through their provider.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../core/paths/paths';
import { SourceRange } from '../../core/typst-document/typst-document';
import { type DocumentLink, type DocumentLinkProvider, LanguagesHost } from './languages';

const document = { path: ProjectPath.of('/main.typ'), text: 'aaaa bbbb cccc' };

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
    links.registerDocumentLinkProvider(provider('first', [[0, 4], [10, 14]]));
    links.registerDocumentLinkProvider(provider('second', [[2, 6], [5, 9]]));
    links.registerDocumentLinkProvider(provider('high', [[12, 13]]), { priority: 110 });
    expect(describeLinks(links.provideDocumentLinks(document))).toEqual(['first@0-4', 'second@5-9', 'high@12-13']);
  });

  it('stops asking a provider once its registration is disposed', () => {
    const links = new LanguagesHost();
    const registration = links.registerDocumentLinkProvider(provider('only', [[0, 4]]));
    registration.dispose();
    expect(links.provideDocumentLinks(document)).toEqual([]);
  });

  it('resolves a link through the provider that gave it (again after resolving)', () => {
    const links = new LanguagesHost();
    links.registerDocumentLinkProvider(provider('plain', [[0, 4]]));
    links.registerDocumentLinkProvider(provider('resolving', [[5, 9]], (link) => ({ ...link, target: ProjectPath.of('/a.typ') })));
    const [plain, resolving] = links.provideDocumentLinks(document);
    expect(links.resolveDocumentLink(plain)).toBe(plain);
    const resolved = links.resolveDocumentLink(resolving);
    expect(resolved.target).toBe(ProjectPath.of('/a.typ'));
    expect(links.resolveDocumentLink(resolved).target).toBe(ProjectPath.of('/a.typ'));
  });
});
