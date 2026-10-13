// Text in every Typst and text file, in search everywhere. See textFiles in ../text-files.ts.
import { ProjectPath } from '../../../core/paths/paths';
import type { FileContent, Project } from '../../../core/project/project';
import { SourceRange } from '../../../core/typst-document/typst-document';
import type { SearchItem, SearchProvider } from '../../../hosts/window/window';
import type { Workbench } from '../../../hosts/workbench/workbench';
import { findText, type TextMatch } from '../model/find-text';

/**
 * "Text" (prefix `%`, as VS Code's quick search): the lines of every Typst and text file holding the query
 * (case-insensitive, from 2 characters, at most 200), with file and line; picking one opens the file with the match
 * selected. Goes through the files in slices, so typing stays smooth, and stops once the query changed.
 */
export function textSearch(options: TextSearchOptions): SearchProvider {
  return {
    id: 'textFiles.text',
    label: 'Text',
    prefix: '%',
    order: 90,
    provideItems: async (query, token) => {
      if (query.length < MIN_QUERY) return [];
      const items: SearchItem[] = [];
      let slice = Date.now();
      for (const path of options.project.paths().filter((path) => ProjectPath.isTypst(path) || options.isTextFile(path))) {
        if (Date.now() - slice > SLICE) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          slice = Date.now();
        }
        if (token.isCancellationRequested) return [];
        const text = textOf(options.project.content(path));
        for (const match of findText(text, query, LIMIT - items.length)) items.push(textItem(path, match, options));
        if (items.length >= LIMIT) break;
      }
      return items;
    },
  };
}

export interface TextSearchOptions {
  readonly project: Pick<Project, 'paths' | 'content'>;
  readonly workbench: Pick<Workbench, 'open'>;
  /** Whether `path` is a text file (searched besides the Typst files). */
  isTextFile(path: ProjectPath): boolean;
}

/** Shorter queries find too much to be useful. */
const MIN_QUERY = 2;

/** Work this long (ms) before letting the browser handle input again. */
const SLICE = 10;

function textOf(content: FileContent | undefined): string {
  if (content === undefined) return '';
  return typeof content === 'string' ? content : new TextDecoder().decode(content);
}

/** Lines listed at most. */
const LIMIT = 200;

function textItem(path: ProjectPath, match: TextMatch, { workbench }: TextSearchOptions): SearchItem {
  return {
    label: match.preview,
    description: `${ProjectPath.displayName(path)}:${match.line}`,
    highlights: { label: match.highlights },
    accept: () => workbench.open(path, { selection: SourceRange.of(match) }),
  };
}
