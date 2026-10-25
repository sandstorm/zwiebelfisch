import { describe, expect, it } from 'vitest';
import { templatesFor } from './open-dialog';

const root = { name: 'report', path: '/_templates/report', scope: '/' };
const year = { name: '2026', path: '/2026/_template', scope: '/2026' };
const other = { name: 'letters', path: '/letters/_template', scope: '/letters' };

describe('templatesFor', () => {
  it('offers the templates on the way up, nearest first', () => {
    expect(templatesFor([root, year, other], '/2026/q3')).toEqual([year, root]);
    expect(templatesFor([root, year, other], '/2026/q3/draft')).toEqual([year, root]);
  });

  it('offers only the repository-wide ones at the top level', () => {
    expect(templatesFor([root, year, other], '/2026')).toEqual([root]);
    expect(templatesFor([root, year], '/2026x/q1')).toEqual([root]);
  });
});
