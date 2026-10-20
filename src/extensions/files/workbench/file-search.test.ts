// Tests for file-search.ts.
import { describe, expect, it, vi } from 'vitest';
import { CancellationTokenSource } from '../../../core/cancellation/cancellation';
import { ProjectPath } from '../../../core/paths/paths';
import { Project } from '../../../core/project/project';
import { fileSearch } from './file-search';

describe('fileSearch', () => {
  it('lists every file by name, with the path of those in folders, and opens the one picked', async () => {
    const project = new Project(ProjectPath.of('/main.typ'), { '/main.typ': '', '/chapters/intro.typ': '', '/logo.png': new Uint8Array() });
    const open = vi.fn();
    const items = await fileSearch(project, { showDocument: open }).provideItems('', new CancellationTokenSource().token);
    expect(items.map(({ label, description }) => [label, description])).toEqual([
      ['main.typ', undefined],
      ['intro.typ', 'chapters/intro.typ'],
      ['logo.png', undefined],
    ]);
    items[1].accept();
    expect(open).toHaveBeenCalledWith('/chapters/intro.typ');
  });
});
