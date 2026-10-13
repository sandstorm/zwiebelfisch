// Tests for markdown-signals.ts: how surely a text is Markdown.
import { describe, expect, it } from 'vitest';
import { markdownLikelihood } from './markdown-signals';

describe('markdownLikelihood', () => {
  it('Markdown-only syntax: headings, strong, links, task items, quotes, tables', () => {
    expect(markdownLikelihood('## Setup\n\nRun **this**.')).toBe('sure');
    expect(markdownLikelihood('See [the docs](https://typst.app/docs).')).toBe('sure');
    expect(markdownLikelihood('- [ ] open\n- [x] done')).toBe('sure');
    expect(markdownLikelihood('> quoted')).toBe('sure');
    expect(markdownLikelihood('| a | b |\n|---|---|')).toBe('sure');
  });

  it('Typst-only syntax: set rules, calls, headings, labels, references, numbered items', () => {
    expect(markdownLikelihood('#set text(lang: "de")\n= Title')).toBe('no');
    expect(markdownLikelihood('#figure(rect()) <fig>')).toBe('no');
    expect(markdownLikelihood('As @fig *shows*')).toBe('no');
  });

  it('shared syntax is maybe Markdown (*x*, lists, fences); prose is none', () => {
    expect(markdownLikelihood('Some *text*')).toBe('maybe');
    expect(markdownLikelihood('- a\n- b\n\n```js\nx\n```')).toBe('maybe');
    expect(markdownLikelihood('Just prose for $5.')).toBe('no');
  });

  it('more Markdown lines than Typst ones are sure, fewer maybe', () => {
    expect(markdownLikelihood('# Title\n\n**a** and **b**\n\n[x](y)\n\n@ref')).toBe('sure');
    expect(markdownLikelihood('= Title\n#set page(width: 10cm)\n**odd**')).toBe('maybe');
  });
});
