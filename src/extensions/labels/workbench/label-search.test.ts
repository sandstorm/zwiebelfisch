// Tests for label-search.ts.
import { describe, expect, it, vi } from 'vitest';
import { CancellationTokenSource } from '../../../core/cancellation/cancellation';
import { ProjectPath } from '../../../core/paths/paths';
import { Project } from '../../../core/project/project';
import { LabelIndex } from '../model/label-index';
import { labelSearch } from './label-search';

describe('labelSearch', () => {
  it('lists the labels but those of figures and bibliography keys, and opens the one picked at the label', async () => {
    const main = '= Introduction <intro>\n$ x = 1 $ <eq>\n#figure(table(columns: 1)[a], caption: [Runs]) <tab:runs>\n#include "a.typ"\n';
    const project = new Project(ProjectPath.of('/main.typ'), { '/main.typ': main, '/a.typ': 'See @intro. <note>\n', '/refs.bib': '@book{knuth, title={T}}\n' });
    const open = vi.fn();
    const items = await labelSearch(new LabelIndex(project), project, { open }).provideItems('', new CancellationTokenSource().token);
    expect(items.map(({ label, description }) => [label, description])).toEqual([
      ['intro', 'Section · Introduction · main.typ'],
      ['eq', 'Equation · main.typ'],
      ['note', 'a.typ'],
    ]);
    items[0].accept();
    expect(open).toHaveBeenCalledWith('/main.typ', { selection: { from: 15, to: 15 } });
  });
});
