// @vitest-environment jsdom
// Tests for word-processor-html.ts: HTML of Word, Google Docs and LibreOffice cleaned for the Visual editor's HTML rules.
import { describe, expect, it } from 'vitest';
// the clipboard HTML of each app, written by hand from the shapes they copy
import googleDocs from './fixtures/google-docs.html?raw';
import libreOffice from './fixtures/libreoffice.html?raw';
import word from './fixtures/word.html?raw';
import { wordProcessorHtml } from './word-processor-html';

/** `html` cleaned, as a document's body. */
const cleaned = (html: string) => Object.assign(document.createElement('body'), { innerHTML: wordProcessorHtml(html) });

describe('wordProcessorHtml', () => {
  it("Word: lists from its list paragraphs (bullets, nested, numbered), without <o:p>, markers or empty paragraphs", () => {
    const body = cleaned(word);
    expect(body.innerHTML).not.toContain('o:p');
    expect([...body.children].map((element) => element.localName)).toEqual(['h1', 'p', 'ul', 'ol']);
    const [bullets, numbers] = [body.querySelector('ul')!, body.querySelector('ol')!];
    expect([...bullets.querySelectorAll(':scope > li > p')].map((p) => p.textContent)).toEqual(['Cold start', 'Incremental']);
    expect(bullets.querySelector('li > ul > li')!.textContent).toBe('With fonts');
    expect([...numbers.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Compile', 'Measure']);
    expect(body.querySelector('p')!.textContent).toBe('The run took 18\u00a0ms and 4 ms warm, see Table 1.');
  });

  it("Google Docs: no docs-internal-guid wrapper, no <br> between blocks; monospace text as code; a heading's bold dropped", () => {
    const body = cleaned(googleDocs);
    expect(body.querySelector('b')).toBeNull();
    expect(body.querySelector(':scope > br')).toBeNull();
    expect([...body.children].map((element) => element.localName)).toEqual(['h2', 'p', 'ul', 'p']);
    expect(body.querySelector<HTMLElement>('h2 span')!.style.fontWeight).toBe('');
    expect(body.querySelector<HTMLElement>('p span:nth-child(2)')!.style.fontWeight).toBe('700');
    expect(body.querySelector('code')!.textContent).toBe('typst compile');
  });

  it("LibreOffice: no empty paragraphs, <font face> monospace as code, a heading's <b> dropped", () => {
    const body = cleaned(libreOffice);
    expect([...body.children].map((element) => element.localName)).toEqual(['h2', 'p', 'ul', 'p']);
    expect(body.querySelector('h2')!.innerHTML).toBe('<font face="Liberation Sans, sans-serif">Results</font>');
    expect(body.querySelector('code')!.textContent).toBe('typst compile');
  });

  it('a heading with only some bold text keeps it', () => {
    const html = '<b id="docs-internal-guid-1"><h1><span style="font-weight:700">Bold</span><span style="font-weight:400"> plain</span></h1></b>';
    expect(cleaned(html).querySelector<HTMLElement>('h1 span')!.style.fontWeight).toBe('700');
  });

  it("other HTML stays as it is (a web page's empty paragraph, monospace span)", () => {
    const html = '<p>&nbsp;</p><p><span style="font-family: monospace">x</span></p><br>';
    expect(wordProcessorHtml(html)).toBe(html);
  });
});
