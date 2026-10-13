// Tests for text-search.ts.
import { describe, expect, it, vi } from 'vitest';
import { CancellationTokenSource } from '../../../core/cancellation/cancellation';
import { ProjectPath } from '../../../core/paths/paths';
import { Project } from '../../../core/project/project';
import { textSearch } from './text-search';

function setup() {
  const project = new Project(ProjectPath.of('/main.typ'), {
    '/main.typ': '= Compile times\nThey grow.\n',
    '/data/runs.csv': 'pages,compile\n10,0.3\n',
    '/logo.png': new Uint8Array([1, 2]),
  });
  const open = vi.fn();
  const search = textSearch({ project, workbench: { open }, isTextFile: (path) => path.endsWith('.csv') });
  return { search, open };
}

describe('textSearch', () => {
  it('finds the lines of the Typst and text files holding the query, marked, with file and line', async () => {
    const { search } = setup();
    const items = await search.provideItems('compile', new CancellationTokenSource().token);
    expect(items.map(({ label, description, highlights }) => [label, description, highlights])).toEqual([
      ['= Compile times', 'main.typ:1', { label: [[2, 9]] }],
      ['pages,compile', 'data/runs.csv:1', { label: [[6, 13]] }],
    ]);
  });

  it('opens the file with the match selected', async () => {
    const { search, open } = setup();
    const [typst, csv] = await search.provideItems('compile', new CancellationTokenSource().token);
    typst.accept();
    expect(open).toHaveBeenCalledWith('/main.typ', { selection: { from: 2, to: 9 } });
    csv.accept();
    expect(open).toHaveBeenLastCalledWith('/data/runs.csv', { selection: { from: 6, to: 13 } });
  });

  it('waits for 2 characters, and gives nothing once cancelled', async () => {
    const { search } = setup();
    expect(await search.provideItems('c', new CancellationTokenSource().token)).toEqual([]);
    const source = new CancellationTokenSource();
    source.cancel();
    expect(await search.provideItems('compile', source.token)).toEqual([]);
  });
});
