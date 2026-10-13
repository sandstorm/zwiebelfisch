// @vitest-environment jsdom
// Tests for morph.ts.
import { describe, expect, it } from 'vitest';
import { morphDocument } from './morph';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const page = (body: string, title = 'Page') => parse(`<!DOCTYPE html><html lang="en"><head><title>${title}</title></head><body>${body}</body></html>`);

describe('morphDocument', () => {
  it('makes the shown document the new one', () => {
    const shown = page('<p>old</p>');
    morphDocument(shown, page('<h2 data-typst-element="1">Title</h2><p class="x">new</p>', 'New'));
    expect(shown.title).toBe('New');
    expect(shown.documentElement.lang).toBe('en');
    expect(shown.body.innerHTML).toBe('<h2 data-typst-element="1">Title</h2><p class="x">new</p>');
  });

  it('keeps the elements that stay, so the page keeps its scroll position and loaded pictures', () => {
    const shown = page('<p data-typst-element="a">First</p><img src="blob:x"><p data-typst-element="b">Second</p>');
    const [first, image, second] = [...shown.body.children];
    morphDocument(shown, page('<p data-typst-element="a">First, longer</p><img src="blob:x"><p data-typst-element="b">Second</p>'));
    expect([...shown.body.children]).toEqual([first, image, second]);
    expect(first.textContent).toBe('First, longer');
  });

  it('inserts and removes marked elements without touching those after them', () => {
    const shown = page('<p data-typst-element="a">A</p><p data-typst-element="c">C</p>');
    const [a, c] = [...shown.body.children];
    morphDocument(shown, page('<p data-typst-element="a">A</p><p data-typst-element="b">B</p><p data-typst-element="c">C</p>'));
    expect(shown.body.children[0]).toBe(a);
    expect(shown.body.children[2]).toBe(c);
    expect(shown.body.textContent).toBe('ABC');
    morphDocument(shown, page('<p data-typst-element="c">C</p>'));
    expect([...shown.body.children]).toEqual([c]);
  });

  it('replaces an element of another tag, and removes attributes that went', () => {
    const shown = page('<p data-typst-element="a" class="x">A</p>');
    const before = shown.body.firstElementChild;
    morphDocument(shown, page('<h3 data-typst-element="a">A</h3><p>B</p>'));
    expect(shown.body.firstElementChild).not.toBe(before);
    expect(shown.body.innerHTML).toBe('<h3 data-typst-element="a">A</h3><p>B</p>');
  });
});
