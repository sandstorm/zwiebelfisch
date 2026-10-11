// Tests for pasted-labels.ts: new names for pasted labels the project has already, and the references along.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { SourceRange } from '../../../core/typst-document/typst-document';
import type { LabelInfo } from './label-index';
import { renamePastedLabels } from './pasted-labels';

const A = ProjectPath.of('/a.typ');
const B = ProjectPath.of('/b.typ');
const FIGURE = '#figure(rect(), caption: [Setup]) <fig:setup>';

/** The project's labels: `names` in file `path`. */
const labels = (path: ProjectPath, ...names: string[]): LabelInfo[] => names.map((name) => ({ name, kind: null, title: null, path }));

/** `pasted` going in at the end of `/a.typ` (text `text`), with `others` the labels of the other files. */
function paste(pasted: string, text: string, others: LabelInfo[] = []): string {
  const end = SourceRange.of({ from: text.length, to: text.length });
  return renamePastedLabels(pasted, { path: A, text }, [end], others);
}

describe('renamePastedLabels', () => {
  it('appends -1 to a label the file has already, then -2 for the next copy', () => {
    expect(paste(FIGURE, `${FIGURE}\n`)).toBe('#figure(rect(), caption: [Setup]) <fig:setup-1>');
    expect(paste(FIGURE, `${FIGURE}\n#figure(rect()) <fig:setup-1>\n`)).toBe('#figure(rect(), caption: [Setup]) <fig:setup-2>');
  });

  it('renames a label another file has (headings and tables too); the target file\'s own index entries count as its text says', () => {
    expect(paste('= Intro <intro>\n', '', labels(B, 'intro'))).toBe('= Intro <intro-1>\n');
    expect(paste('#figure(table[x]) <tab:t>', 'Text\n', labels(A, 'tab:t'))).toBe('#figure(table[x]) <tab:t>');
  });

  it('renames the references inside the paste to a renamed label; others stay, pointing to the original', () => {
    const pasted = `${FIGURE}\nSee @fig:setup[Figure], #ref(<fig:setup>) and #link(<fig:setup>)[it]; also @intro.`;
    expect(paste(pasted, `${FIGURE}\n`, labels(B, 'intro'))).toBe(
      '#figure(rect(), caption: [Setup]) <fig:setup-1>\nSee @fig:setup-1[Figure], #ref(<fig:setup-1>) and #link(<fig:setup-1>)[it]; also @intro.',
    );
    expect(paste('See @fig:setup.', `${FIGURE}\n`)).toBe('See @fig:setup.');
  });

  it('keeps a new name clear of the project and of the other labels of the paste', () => {
    const pasted = '= A <a>\n= A one <a-1>\n';
    expect(paste(pasted, '= A <a>\n= A one <a-1>\n', labels(B, 'a-2'))).toBe('= A <a-3>\n= A one <a-1-1>\n');
  });

  it('leaves a label the project does not have, and one only the replaced text had (cut and pasted, or pasted over)', () => {
    expect(paste(FIGURE, 'Text\n')).toBe(FIGURE);
    const text = `Text\n${FIGURE}\n`;
    const figure = SourceRange.of({ from: 5, to: 5 + FIGURE.length });
    expect(renamePastedLabels(FIGURE, { path: A, text }, [figure], labels(A, 'fig:setup'))).toBe(FIGURE);
  });
});
