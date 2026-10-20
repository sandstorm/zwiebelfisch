// Tests for heading-search.ts.
import { describe, expect, it, vi } from 'vitest';
import { CancellationTokenSource } from '../../../core/cancellation/cancellation';
import { ProjectPath } from '../../../core/paths/paths';
import { Project } from '../../../core/project/project';
import { SourceOffset } from '../../../core/typst-document/typst-document';
import { headingSearch } from './heading-search';

describe('headingSearch', () => {
  it("lists every Typst file's headings with level and file, and opens the one picked at its heading", async () => {
    const project = new Project(ProjectPath.of('/main.typ'), { '/main.typ': '= Report\n#include "a.typ"\n', '/a.typ': 'Intro.\n\n== Method\n', '/notes.md': '# Not Typst\n' });
    const open = vi.fn();
    const search = headingSearch(project, { showDocument: open });
    const token = new CancellationTokenSource().token;
    const items = await search.provideItems('', token);
    expect(items.map(({ label, description }) => [label, description])).toEqual([
      ['Report', 'H1 · main.typ'],
      ['Method', 'H2 · a.typ'],
    ]);
    items[1].accept();
    expect(open).toHaveBeenCalledWith('/a.typ', { selection: { from: 11, to: 11 } });
    project.document(ProjectPath.of('/a.typ'))!.change([{ from: SourceOffset.of(0), to: SourceOffset.of(0), insert: '== New\n' }], 'test');
    expect((await search.provideItems('', token)).map(({ label }) => label)).toEqual(['Report', 'New', 'Method']);
  });
});
