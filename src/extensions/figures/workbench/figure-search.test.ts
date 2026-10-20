// Tests for figure-search.ts.
import { describe, expect, it, vi } from 'vitest';
import { CancellationTokenSource } from '../../../core/cancellation/cancellation';
import { ProjectPath } from '../../../core/paths/paths';
import { Project } from '../../../core/project/project';
import { figureSearch } from './figure-search';

describe('figureSearch', () => {
  it('lists the figures of every Typst file by caption, else label, and opens the one picked at the figure', async () => {
    const project = new Project(ProjectPath.of('/main.typ'), {
      '/main.typ': 'Text.\n#figure(table(columns: 1)[a], caption: [Runs]) <tab:runs>\n',
      '/a.typ': '#figure(image("x.png")) <fig:x>\n',
    });
    const open = vi.fn();
    const items = await figureSearch(project, { showDocument: open }).provideItems('', new CancellationTokenSource().token);
    expect(items.map(({ label, description }) => [label, description])).toEqual([
      ['Runs', 'Table · <tab:runs> · main.typ'],
      ['<fig:x>', 'Figure · a.typ'],
    ]);
    items[0].accept();
    expect(open).toHaveBeenCalledWith('/main.typ', { selection: { from: 6, to: 6 } });
  });
});
