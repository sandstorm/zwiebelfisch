// Tests for label-description.ts: how a label is described.
import { describe, expect, it } from 'vitest';
import type { LabelInfo } from './label-index';
import { describeLabel } from './label-description';
import { ProjectPath } from '../../../core/paths/paths';

const path = ProjectPath.of;

const LABELS: LabelInfo[] = [
  { name: 'intro', kind: 'heading', title: 'Introduction', path: path('/chapters/introduction.typ') },
  { name: 'method', kind: 'heading', title: 'Method', path: path('/chapters/method.typ') },
  { name: 'eq:speedup', kind: 'equation', title: null, path: path('/chapters/method.typ') },
  { name: 'results', kind: 'heading', title: 'Results', path: path('/chapters/results.typ') },
  { name: 'tab:timings', kind: 'table', title: 'Median compile times (illustrative numbers).', path: path('/chapters/results.typ') },
  { name: 'fig:compile-times', kind: 'figure', title: 'Cold (dark) and incremental (light) compile times for 1, 10, 50 and 100 pages.', path: path('/chapters/results.typ') },
  { name: 'knuth1984', kind: 'bibliography', title: null, path: path('/refs.bib') },
  { name: 'intro', kind: 'heading', title: 'Duplicate', path: path('/other.typ') },
];

describe('describeLabel', () => {
  it('names the kind and the title, shortened', () => {
    expect(describeLabel(LABELS[0])).toBe('Section · Introduction');
    expect(describeLabel(LABELS[2])).toBe('Equation');
    expect(describeLabel(LABELS[4])).toBe('Table · Median compile times (illustrative…');
    expect(describeLabel(LABELS[5])).toBe('Figure · Cold (dark) and incremental (light)…');
  });

  it('has nothing to say about bibliography keys and unknown elements', () => {
    expect(describeLabel(LABELS[6])).toBeNull();
    expect(describeLabel({ name: 'p', kind: null, title: null, path: path('/a.typ') })).toBeNull();
  });
});
