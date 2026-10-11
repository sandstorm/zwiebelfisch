// The help sheet of Typst. See typstLanguage in ../typst-language.ts.
import type { HelpSheet } from '../../../hosts/languages/languages';

/**
 * "Typst basics": the markup, math and code a document is written in (Typst 0.15), each row ready to insert.
 */
export const TYPST_HELP: HelpSheet = {
  title: 'Typst basics',
  sections: [
    {
      title: 'Headings',
      rows: [
        { snippet: '= Heading', description: 'A heading; each more = one level deeper' },
        { snippet: '== Subheading', description: 'A heading of the second level' },
      ],
    },
    {
      title: 'Emphasis',
      rows: [
        { snippet: '_emphasis_', description: 'Italic' },
        { snippet: '*strong*', description: 'Bold' },
        { snippet: '#underline[underlined]', description: 'Underlined' },
      ],
    },
    {
      title: 'Lists',
      rows: [
        { snippet: '- Item', description: 'A bullet list item; indent to nest' },
        { snippet: '+ Item', description: 'A numbered list item' },
        { snippet: '/ Term: Description', description: 'A term list item' },
      ],
    },
    {
      title: 'Links and references',
      rows: [
        { snippet: 'https://typst.app', description: 'A URL is a link by itself' },
        { snippet: '#link("https://typst.app")[Typst]', description: 'A link with a text of its own' },
        { snippet: '= Introduction <intro>', description: 'A label after a heading (or figure, equation) to refer to' },
        { snippet: '@intro', description: 'A reference to the label <intro>: "Section 1"' },
      ],
    },
    {
      title: 'Images and figures',
      rows: [
        { snippet: '#image("image.png", width: 80%)', description: 'An image file of the project' },
        {
          snippet: '#figure(\n  image("image.png", width: 80%),\n  caption: [A caption],\n) <fig:image>',
          description: 'A numbered figure with a caption and a label (@fig:image refers to it)',
        },
      ],
    },
    {
      title: 'Math',
      rows: [
        { snippet: '$x^2 + y_1$', description: 'Inline math: no spaces inside the dollars' },
        { snippet: '$ sum_(i=1)^n i = (n(n+1)) / 2 $', description: 'Display math: spaces inside the dollars' },
        { snippet: '$ a = b $ <eq:ab>', description: 'A display equation with a label' },
      ],
    },
    {
      title: 'Tables',
      rows: [
        {
          snippet: '#table(\n  columns: 2,\n  table.header[*Name*][*Value*],\n  [A], [1],\n  [B], [2],\n)',
          description: 'A table: columns, a header row, then the cells row by row',
        },
      ],
    },
    {
      title: 'Code',
      rows: [
        { snippet: '`code`', description: 'Inline code' },
        { snippet: '```python\nprint("Hello")\n```', description: 'A code block, highlighted for its language' },
      ],
    },
    {
      title: 'Set and show rules',
      rows: [
        { snippet: '#set text(size: 11pt)', description: 'Sets a default for the rest of the file (or the block)' },
        { snippet: '#set page(paper: "a4", margin: 2cm)', description: 'Page size and margins' },
        { snippet: '#set heading(numbering: "1.1")', description: 'Numbered headings' },
        { snippet: '#show heading: set text(fill: blue)', description: 'A set rule only for headings' },
        { snippet: '#show link: underline', description: 'Shows every link through a function' },
      ],
    },
    {
      title: 'Files',
      rows: [
        { snippet: '#import "template.typ": conf', description: 'Names from another Typst file' },
        { snippet: '#import "@preview/merman:0.4.0": mermaid', description: 'Names from a package of Typst Universe (downloaded on first use)' },
        { snippet: '#include "chapter.typ"', description: "Another file's content, in place" },
      ],
    },
    {
      title: 'Comments',
      rows: [
        { snippet: '// A comment', description: 'Until the end of the line' },
        { snippet: '/* A comment */', description: 'A block comment' },
      ],
    },
  ],
  links: [{ label: 'Typst documentation', href: 'https://typst.app/docs' }],
};
