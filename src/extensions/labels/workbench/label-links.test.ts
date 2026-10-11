// Tests for label-links.ts and findLabelLinks in scan.ts: references and links to labels as document links.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { Project } from '../../../core/project/project';
import { LabelIndex } from '../model/label-index';
import { findLabelLinks } from '../model/scan';
import { LabelLinks } from './label-links';

const path = ProjectPath.of;

const MAIN = 'See @fig:setup[Figure], #link(<intro>)[the intro] and @knuth, not @nowhere.\n#include "ch2.typ"\n';
const CH2 = '= Introduction <intro>\n#figure(image("a.png"), caption: [The measurement setup]) <fig:setup>\n';

function setup() {
  const project = new Project(path('/main.typ'), { '/main.typ': MAIN, '/ch2.typ': CH2, '/refs.bib': '@book{knuth, title={T}}\n' });
  const provider = new LabelLinks(new LabelIndex(project), project);
  const links = provider.provideDocumentLinks({ path: path('/main.typ'), languageId: 'typst', text: MAIN });
  return { provider, links };
}

describe('findLabelLinks', () => {
  it('finds references (with their supplement) and link calls to a label (with their #), but no other links', () => {
    const text = '@a and @b[Fig] #link(<c>)[C] #link("https://x.org")[X] #link(<d>)';
    expect(findLabelLinks(text).map(({ name, range }) => [name, text.slice(range.from, range.to)])).toEqual([
      ['a', '@a'],
      ['b', '@b[Fig]'],
      ['c', '#link(<c>)[C]'],
      ['d', '#link(<d>)'],
    ]);
  });
});

describe('LabelLinks', () => {
  it('links every reference and link to a label', () => {
    const { links } = setup();
    expect(links.map(({ range }) => MAIN.slice(range.from, range.to))).toEqual(['@fig:setup[Figure]', '#link(<intro>)[the intro]', '@knuth', '@nowhere']);
  });

  it('resolves a link to its label: in its file, at the label, saying what it labels', () => {
    const { provider, links } = setup();
    const [figure, intro] = links.map((link) => provider.resolveDocumentLink(link));
    const at = CH2.indexOf('<fig:setup>');
    expect(figure).toMatchObject({ target: '/ch2.typ', selection: { from: at, to: at }, tooltip: 'Go to Figure · The measurement setup in ch2.typ' });
    expect(intro).toMatchObject({ target: '/ch2.typ', selection: { from: 15, to: 15 }, tooltip: 'Go to Section · Introduction in ch2.typ' });
  });

  it('leads a bibliography key to its file, and a missing label nowhere', () => {
    const { provider, links } = setup();
    expect(provider.resolveDocumentLink(links[2])).toMatchObject({ target: '/refs.bib', tooltip: 'Go to <knuth> in refs.bib' });
    expect(provider.resolveDocumentLink(links[2]).selection).toBeUndefined();
    expect(provider.resolveDocumentLink(links[3]).target).toBeUndefined();
  });
});
