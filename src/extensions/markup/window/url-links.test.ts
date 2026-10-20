// Tests for url-links.ts: web and mail addresses as document links.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { urlLinks } from './url-links';

const links = (text: string) =>
  urlLinks.provideDocumentLinks({ path: ProjectPath.of('/main.typ'), languageId: 'typst', text }).map(({ range, target }) => [text.slice(range.from, range.to), String(target)]);

describe('urlLinks', () => {
  it('links bare URLs and link calls to a web or mail address, to that address', () => {
    expect(links('See https://typst.app. #link("https://typst.app/docs")[the docs], #link("mailto:a@b.org")')).toEqual([
      ['https://typst.app', 'https://typst.app/'],
      ['#link("https://typst.app/docs")[the docs]', 'https://typst.app/docs'],
      ['#link("mailto:a@b.org")', 'mailto:a@b.org'],
    ]);
  });

  it('leaves out links to labels, files, computed and other addresses', () => {
    expect(links('#link(<intro>)[A] #link("chapter.typ")[B] #link(url)[C] #link("javascript:alert(1)")[D]')).toEqual([]);
  });
});
