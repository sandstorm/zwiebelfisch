// Tests for label-index.ts and scan.ts: the project's label index, reference counts and renaming references across files.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Project } from '../../../core/project/project';
import { LabelIndex } from './label-index';
import { calculateReferenceRenames } from './scan';
import { ProjectPath } from '../../../core/paths/paths';

const path = ProjectPath.of;

const ADVANCED = new URL('../../../../demo/examples/advanced/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ADVANCED), 'utf8');

/** The demo's advanced example (its Typst files). */
function advanced(): Project {
  const files = Object.fromEntries(
    ['main.typ', 'template.typ', 'helpers.typ', 'chapters/introduction.typ', 'chapters/method.typ', 'chapters/results.typ'].map((p) => [`/${p}`, read(p)]),
  );
  return new Project(path('/main.typ'), files);
}

describe('LabelIndex', () => {
  it('lists the labels of every file with their kind, title and file', () => {
    const index = new LabelIndex(advanced());
    expect(index.labels()).toEqual([
      { name: 'intro', kind: 'heading', title: 'Introduction', path: path('/chapters/introduction.typ') },
      { name: 'method', kind: 'heading', title: 'Method', path: path('/chapters/method.typ') },
      { name: 'eq:speedup', kind: 'equation', title: null, path: path('/chapters/method.typ') },
      { name: 'fig:measurement', kind: 'figure', title: 'One round of the measurement, per document size.', path: path('/chapters/method.typ') },
      { name: 'results', kind: 'heading', title: 'Results', path: path('/chapters/results.typ') },
      { name: 'tab:timings', kind: 'table', title: 'Median compile times (illustrative numbers).', path: path('/chapters/results.typ') },
      {
        name: 'fig:compile-times',
        kind: 'figure',
        title: 'Cold (dark) and incremental (light) compile times for 1, 10, 50 and 100 pages.',
        path: path('/chapters/results.typ'),
      },
      { name: 'tab:runs', kind: 'figure', title: 'Cold compile times (ms) of three runs per document size.', path: path('/chapters/results.typ') },
    ]);
  });

  it('counts references across files', () => {
    const index = new LabelIndex(advanced());
    expect(index.referenceCount('method')).toBe(1);
    expect(index.referenceCount('fig:compile-times')).toBe(2);
    expect(index.referenceCount('eq:speedup')).toBe(2);
    expect(index.referenceCount('intro')).toBe(0);
  });

  it('follows edits, and tells listeners only when the labels changed', () => {
    const project = advanced();
    const index = new LabelIndex(project);
    const listener = vi.fn();
    index.onDidChange(listener);
    const method = project.document(path('/chapters/method.typ'))!;
    method.setText(method.text.replace('We generated', 'We made'), 'test');
    expect(listener).not.toHaveBeenCalled();
    method.setText(method.text.replace('= Method <method>', '= Approach <approach>'), 'test');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(index.labels().map((l) => l.name)).toContain('approach');
    expect(index.labels().find((l) => l.name === 'approach')?.title).toBe('Approach');
    expect(index.labels().map((l) => l.name)).not.toContain('method');
  });

  it('follows created, renamed and deleted files', () => {
    const project = advanced();
    const index = new LabelIndex(project);
    project.apply({ kind: 'create', path: path('/appendix.typ'), content: '= Appendix <appendix>\n\nSee @intro.\n' });
    const appendix = () => index.labels().find((l) => l.name === 'appendix');
    expect(appendix()).toEqual({ name: 'appendix', kind: 'heading', title: 'Appendix', path: path('/appendix.typ') });
    expect(index.referenceCount('intro')).toBe(1);
    project.apply({ kind: 'rename', from: path('/appendix.typ'), path: path('/extra.typ') });
    expect(appendix()?.path).toBe(path('/extra.typ'));
    project.apply({ kind: 'delete', path: path('/extra.typ') });
    expect(index.labels().map((l) => l.name)).not.toContain('appendix');
  });

  it('picks up replaced files', () => {
    const project = new Project(path('/main.typ'), { '/main.typ': 'See @method.\n' });
    const index = new LabelIndex(project);
    const listener = vi.fn();
    index.onDidChange(listener);
    project.replace({ '/method.typ': '= Method <method>\n\nAs @intro says.\n' });
    expect(index.labels()).toEqual([{ name: 'method', kind: 'heading', title: 'Method', path: path('/method.typ') }]);
    expect(index.referenceCount('intro')).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    project.replace({});
    expect(index.labels()).toEqual([]);
    expect(index.referenceCount('intro')).toBe(0);
  });

  it('lists bibliography keys without a kind', () => {
    const bib = '@book{knuth1984,\n  title = {The TeXbook},\n}\n@article{ lamport94 , title={LaTeX}}\n';
    const project = new Project(path('/main.typ'), { '/main.typ': '@knuth1984\n', '/refs.bib': new TextEncoder().encode(bib) });
    expect(new LabelIndex(project).labels()).toEqual([
      { name: 'knuth1984', kind: 'bibliography', title: null, path: path('/refs.bib') },
      { name: 'lamport94', kind: 'bibliography', title: null, path: path('/refs.bib') },
    ]);
  });

  it('renames references in every file but the one given, one change per file', () => {
    const project = advanced();
    const index = new LabelIndex(project);
    const intro = project.document(path('/chapters/introduction.typ'))!;
    const results = project.document(path('/chapters/results.typ'))!;
    const changes = vi.fn();
    results.onDidChange(changes);
    index.renameReferences('fig:compile-times', 'fig:times', intro);
    expect(results.text).toContain('@fig:times shows the same data');
    expect(results.text).toContain('<fig:compile-times>'); // the label itself is the Visual view's to change
    expect(changes).toHaveBeenCalledTimes(1);
    expect(intro.text).toContain('@fig:compile-times sums them up');
    index.renameReferences('fig:compile-times', 'fig:times');
    expect(intro.text).toContain('@fig:times sums them up');
  });
});

describe('calculateReferenceRenames', () => {
  it('replaces just the names of matching references', () => {
    const text = 'See @a, @a[Part] and @ab or @a.b; @a. End\n';
    const edits = calculateReferenceRenames(text, 'a', 'start');
    expect(edits).toHaveLength(3);
    let result = text;
    for (const { from, to, insert } of [...edits].reverse()) result = result.slice(0, from) + insert + result.slice(to);
    expect(result).toBe('See @start, @start[Part] and @ab or @a.b; @start. End\n');
  });
});
