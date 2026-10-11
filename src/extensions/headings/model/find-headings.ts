// The headings of Typst source with their level, words and place (search everywhere lists them). See ../headings.ts.
import { typstParser } from 'codemirror-lang-typst/lezer';
import { SourceRange } from '../../../core/typst-document/typst-document';

/** A heading: its level (`==` → 2), its text as written (whitespace collapsed), and where that text is. */
export interface FoundHeading {
  readonly level: number;
  readonly title: string;
  readonly range: SourceRange;
}

/** Every heading of `text` in source order (`= Title` markup; headings with empty text left out). */
export function findHeadings(text: string): FoundHeading[] {
  const headings: FoundHeading[] = [];
  typstParser.parse(text).iterate({
    enter: (node) => {
      if (node.name !== 'Heading') return;
      const markup = node.node.getChild('Markup');
      const title = markup ? text.slice(markup.from, markup.to).replace(/\s+/g, ' ').trim() : '';
      const level = /^=+/.exec(text.slice(node.from))?.[0].length ?? 1;
      if (markup && title) headings.push({ level, title, range: SourceRange.of(markup) });
      return false;
    },
  });
  return headings;
}
