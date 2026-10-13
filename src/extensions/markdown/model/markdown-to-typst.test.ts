// Tests for markdown-to-typst.ts and inline.ts: Markdown's blocks and inline syntax as Typst markup.
import { describe, expect, it } from 'vitest';
import { markdownToTypst } from './markdown-to-typst';

describe('markdownToTypst', () => {
  it('converts an LLM-style answer: headings, emphasis, code, lists, a fence with its language, a link', () => {
    const markdown = [
      '## Setup',
      '',
      'Install it with **pnpm** and *then* run `vite`:',
      '',
      '1. Clone the [repo](https://example.com/repo).',
      '2. Run:',
      '',
      '   ```sh',
      '   pnpm install',
      '   ```',
      '',
      '- one',
      '  - nested',
      '- [ ] open',
      '- [x] done',
      '',
      '---',
    ].join('\n');
    expect(markdownToTypst(markdown)).toBe(
      [
        '== Setup',
        '',
        'Install it with *pnpm* and _then_ run `vite`:',
        '',
        '+ Clone the #link("https://example.com/repo")[repo].',
        '+ Run:',
        '',
        '  ```sh',
        '  pnpm install',
        '  ```',
        '',
        '- one',
        '  - nested',
        '- [ ] open',
        '- [x] done',
        '',
        '#line(length: 100%)',
      ].join('\n'),
    );
  });

  it('escapes what would be Typst markup in text, and keeps escaped Markdown characters as characters', () => {
    expect(markdownToTypst('Costs $5 for #1 @home <tag> // not a comment \\*literal\\*')).toBe(
      'Costs \\$5 for \\#1 \\@home \\<tag> \\// not a comment \\*literal\\*',
    );
    expect(markdownToTypst('Line\n= not a heading\n/ not a term')).toBe('Line\n\\= not a heading\n\\/ not a term');
  });

  it('writes emphasis inside a word, and strikethrough, as functions; leaves snake_case alone', () => {
    expect(markdownToTypst('un**believ**able, ~~gone~~, ***both***, snake_case_name')).toBe(
      'un#strong[believ]able, #strike[gone], *_both_*, snake\\_case\\_name',
    );
  });

  it('keeps bare URLs as they are, writes <url> autolinks and images as calls', () => {
    expect(markdownToTypst('See https://typst.app/docs_x. Or <https://a.b/c>.\n\n![A cat](cat.png "title")')).toBe(
      'See https://typst.app/docs_x. Or #link("https://a.b/c").\n\n#image("cat.png", alt: "A cat")',
    );
  });

  it('reads underlined headings, hard breaks, quotes and indented code', () => {
    expect(markdownToTypst('Title\n=====\n\nfirst  \nsecond\\\nthird\n\n> quoted **text**\n> more\n\n    code  here')).toBe(
      '= Title\n\nfirst \\\nsecond \\\nthird\n\n#quote(block: true)[\nquoted *text*\nmore\n]\n\n```\ncode  here\n```',
    );
  });

  it('makes a pipe table a table with a header row', () => {
    expect(markdownToTypst('| Name | Size |\n|:-----|-----:|\n| `a` | 1 |\n| b \\| c |')).toBe(
      '#table(\n  columns: 2,\n  table.header([Name], [Size]),\n  [`a`], [1],\n  [b | c], [],\n)',
    );
  });

  it('numbers from the first number, writes code with backticks in a longer fence, raw with backticks as a call', () => {
    expect(markdownToTypst('3. three\n4. four')).toBe('3. three\n+ four');
    expect(markdownToTypst('~~~\na ``` b\n~~~')).toBe('````\na ``` b\n````');
    expect(markdownToTypst('Use ``a`b`` here')).toBe('Use #raw("a`b") here');
    expect(markdownToTypst('[a](u)(b) [c](u).Next')).toBe('#link("u")[a]\\(b) #link("u")[c]\\.Next');
  });
});
