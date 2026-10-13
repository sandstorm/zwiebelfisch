// Tests for replace.ts: exact edits in Typst files (one change each), text files through applyEdit (and its veto),
// regular expression groups, matches changed meanwhile, and Undo following later edits.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import type { FileChange } from '../../../core/project/project';
import { Project, type ProjectFiles } from '../../../core/project/project';
import { SourceRange, type TypstDocumentChangeEvent } from '../../../core/typst-document/typst-document';
import { Replacement } from './replace';
import type { FileMatches } from './search-results';
import { TextQuery, type TextQueryOptions } from './text-query';

const path = ProjectPath.of;

function setup(files: ProjectFiles, allow: (change: FileChange) => boolean = () => true) {
  const project = new Project(path('/main.typ'), files);
  const target = { project, applyEdit: async (change: FileChange) => (allow(change) ? (project.apply(change), null) : 'Not here.') };
  /** Replaces every match of `options` in the project's Typst and `.bib` files with `replace`. */
  const replace = (options: TextQueryOptions, replace: string, only?: (file: FileMatches) => FileMatches) => {
    const query = new TextQuery(options);
    const files = project
      .paths()
      .filter((file) => file.endsWith('.typ') || file.endsWith('.bib'))
      .map((file) => ({ path: file, matches: query.findMatches(String(project.content(file)), 100) }))
      .map((file) => (only ? only(file) : file));
    return Replacement.apply(target, query, files, replace);
  };
  return { project, replace, text: (file: string) => project.content(path(file)) };
}

describe('Replacement', () => {
  it('replaces in each Typst file with one change of exact edits, in a text file through applyEdit', async () => {
    const { project, replace, text } = setup({ '/main.typ': 'a cat, a cat\nno dog', '/b.typ': 'cat', '/refs.bib': '@cat' });
    const events: TypstDocumentChangeEvent[] = [];
    project.document(path('/main.typ'))!.onDidChange((event) => events.push(event));
    const done = await replace({ pattern: 'cat' }, 'dog');
    expect([text('/main.typ'), text('/b.typ'), text('/refs.bib')]).toEqual(['a dog, a dog\nno dog', 'dog', '@dog']);
    expect([done.replaced, done.files, done.skipped, done.refused]).toEqual([4, 3, 0, []]);
    expect(events).toEqual([{ contentChanges: [{ ...SourceRange.of({ from: 2, to: 5 }), insert: 'dog' }, { ...SourceRange.of({ from: 9, to: 12 }), insert: 'dog' }], origin: 'search' }]);
  });

  it('fills in regular expression groups', async () => {
    const { replace, text } = setup({ '/main.typ': 'ann@example, bob@test' });
    await replace({ pattern: '(?<user>\\w+)@(\\w+)', isRegExp: true }, '$2: $<user>');
    expect(text('/main.typ')).toBe('example: ann, test: bob');
  });

  it('leaves a match whose text changed since it was found, and a text file the host refuses', async () => {
    const { project, replace, text } = setup({ '/main.typ': 'cat cat', '/refs.bib': '@cat' }, (change) => change.path !== '/refs.bib');
    const done = await replace({ pattern: 'cat' }, 'dog', (file) => {
      // the first match of main.typ is edited after it was found
      if (file.path === '/main.typ') project.document(file.path)!.change([{ ...SourceRange.of({ from: 0, to: 1 }), insert: 'b' }], 'test');
      return file;
    });
    expect([text('/main.typ'), text('/refs.bib')]).toEqual(['bat dog', '@cat']);
    expect([done.replaced, done.skipped, done.refused]).toEqual([1, 1, [{ path: '/refs.bib', reason: 'Not here.' }]]);
  });

  it('undoes in all files at once, following later edits; leaves a replacement edited into and a text file changed since', async () => {
    const { project, replace, text } = setup({ '/main.typ': 'cat and cat and cat', '/b.typ': 'cat', '/refs.bib': '@cat', '/more.bib': '@cat' });
    const done = await replace({ pattern: 'cat' }, 'dog');
    const main = project.document(path('/main.typ'))!;
    // typed before the first, into the second
    main.change([{ ...SourceRange.of({ from: 0, to: 0 }), insert: 'A ' }, { ...SourceRange.of({ from: 9, to: 9 }), insert: 'X' }], 'test');
    project.apply({ kind: 'update', path: path('/more.bib'), content: '@dog!' });
    expect(text('/main.typ')).toBe('A dog and dXog and dog');
    expect(await done.undo()).toEqual({ restored: 4, skipped: 2, refused: [] });
    expect([text('/main.typ'), text('/b.typ'), text('/refs.bib'), text('/more.bib')]).toEqual(['A cat and dXog and cat', 'cat', '@cat', '@dog!']);
    expect(await done.undo()).toEqual({ restored: 0, skipped: 0, refused: [] });
  });
});
