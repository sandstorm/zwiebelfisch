// The help sheet of BibTeX files. See textFiles in ../text-files.ts.
import type { HelpSheet } from '../../../hosts/languages/languages';

/**
 * "BibTeX": the entries of a bibliography file (`.bib`) and how a Typst document cites them, each row ready to insert.
 */
export const BIBTEX_HELP: HelpSheet = {
  title: 'BibTeX',
  sections: [
    {
      title: 'Entries',
      rows: [
        {
          snippet: '@article{knuth1984,\n  author = {Knuth, Donald E.},\n  title = {Literate Programming},\n  journal = {The Computer Journal},\n  volume = {27},\n  number = {2},\n  pages = {97--111},\n  year = {1984},\n}',
          description: 'An article in a journal; knuth1984 is the key to cite it by',
        },
        {
          snippet: '@book{lamport1994,\n  author = {Lamport, Leslie},\n  title = {LaTeX: A Document Preparation System},\n  publisher = {Addison-Wesley},\n  year = {1994},\n}',
          description: 'A book',
        },
        {
          snippet: '@misc{typst,\n  title = {Typst},\n  url = {https://typst.app},\n  year = {2023},\n}',
          description: 'Anything else, e.g. a web page',
        },
        { snippet: 'author = {Last, First and Last, First}', description: 'Several authors, joined by "and"' },
      ],
    },
    {
      title: 'In the document',
      rows: [
        { snippet: '#bibliography("refs.bib")', description: 'The bibliography: the entries cited, where it stands' },
        { snippet: '@knuth1984', description: 'Cites an entry by its key' },
        { snippet: '@knuth1984[p.~7]', description: 'Cites with a page' },
        { snippet: '#cite(<knuth1984>, form: "prose")', description: 'Cites in the sentence: "Knuth (1984)"' },
      ],
    },
  ],
  links: [{ label: 'Typst bibliography documentation', href: 'https://typst.app/docs/reference/model/bibliography/' }],
};
