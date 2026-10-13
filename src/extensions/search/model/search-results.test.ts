// Tests for search-results.ts.
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { Project, type ProjectFiles } from '../../../core/project/project';
import { SourceRange } from '../../../core/typst-document/typst-document';
import { SearchResults, type SearchScope } from './search-results';
import { TextQuery } from './text-query';

const path = ProjectPath.of;
const made: SearchResults[] = [];

afterEach(() => {
  for (const results of made.splice(0)) results.dispose();
});

/** Results for `pattern` in `project`, `.bib` files being the text files. */
function search(project: Project, pattern: string, scope: SearchScope = { kind: 'project' }): SearchResults {
  const results = new SearchResults({ project, query: new TextQuery({ pattern }), scope, isTextFile: (file) => file.endsWith('.bib') });
  made.push(results);
  return results;
}

/** Each file with matches, with its matches' lines. */
function listed(results: SearchResults): [string, number[]][] {
  return results.files().map(({ path, matches }) => [path, matches.map(({ line }) => line)]);
}

function project(files: ProjectFiles): Project {
  return new Project(path('/main.typ'), files);
}

describe('SearchResults', () => {
  it('finds the matches in the Typst and text files, in the project order, never in other files', async () => {
    const files = project({
      '/main.typ': 'needle\n#include "b.typ"\nneedle',
      '/b.typ': 'no',
      '/a.typ': 'a needle',
      '/refs.bib': '@book{needle}',
      '/data.csv': 'needle',
      '/logo.png': new TextEncoder().encode('needle'),
    });
    const results = search(files, 'needle');
    await results.searched;
    expect(listed(results)).toEqual([
      ['/main.typ', [1, 3]],
      ['/a.typ', [1]],
      ['/refs.bib', [1]],
    ]);
    expect(results.count).toBe(4);
    expect(results.limitHit).toBe(false);
  });

  it('searches one file, or a folder with its subfolders', async () => {
    const files = project({ '/main.typ': 'x', '/ch/a.typ': 'x', '/ch/sub/b.typ': 'x', '/chapter.typ': 'x' });
    const inFile = search(files, 'x', { kind: 'file', path: path('/ch/a.typ') });
    const inFolder = search(files, 'x', { kind: 'folder', path: path('/ch') });
    await Promise.all([inFile.searched, inFolder.searched]);
    expect(listed(inFile)).toEqual([['/ch/a.typ', [1]]]);
    expect(listed(inFolder)).toEqual([
      ['/ch/a.typ', [1]],
      ['/ch/sub/b.typ', [1]],
    ]);
  });

  it('searches a changed, new or renamed file again at once, and forgets a deleted one', async () => {
    const files = project({ '/main.typ': 'needle', '/a.typ': 'needle' });
    const results = search(files, 'needle');
    await results.searched;
    let told = 0;
    results.onDidChange(() => told++);

    files.document(path('/main.typ'))!.change([{ ...SourceRange.of({ from: 0, to: 0 }), insert: 'x\n' }], 'test');
    expect(listed(results)).toEqual([
      ['/main.typ', [2]],
      ['/a.typ', [1]],
    ]);
    files.apply({ kind: 'create', path: path('/b.typ'), content: 'needle needle' });
    files.apply({ kind: 'rename', from: path('/a.typ'), path: path('/c.typ') });
    files.apply({ kind: 'delete', path: path('/b.typ') });
    expect(listed(results)).toEqual([
      ['/main.typ', [2]],
      ['/c.typ', [1]],
    ]);
    expect(results.count).toBe(2);
    expect(told).toBe(4);

    files.apply({ kind: 'create', path: path('/d.typ'), content: 'nothing' });
    expect(told).toBe(4);
  });

  it('keeps at most 5000 matches and says there are more', async () => {
    const files = project({ '/main.typ': 'x\n'.repeat(3000), '/a.typ': 'x\n'.repeat(3000), '/b.typ': 'x' });
    const results = search(files, 'x');
    await results.searched;
    expect(results.count).toBe(5000);
    expect(results.limitHit).toBe(true);
    expect(listed(results).map(([file, lines]) => [file, lines.length])).toEqual([
      ['/main.typ', 3000],
      ['/a.typ', 2000],
    ]);
  });

  it('finds nothing for an invalid regular expression, and stops listening once disposed', async () => {
    const files = project({ '/main.typ': '(a' });
    const invalid = new SearchResults({ project: files, query: new TextQuery({ pattern: '(a', isRegExp: true }), scope: { kind: 'project' }, isTextFile: () => false });
    await invalid.searched;
    expect(invalid.count).toBe(0);
    invalid.dispose();

    const results = search(files, 'a');
    await results.searched;
    results.dispose();
    files.document(path('/main.typ'))!.setText('', 'test');
    expect(results.count).toBe(1);
  });
});
