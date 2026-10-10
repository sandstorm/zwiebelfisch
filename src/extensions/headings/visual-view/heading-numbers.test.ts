// Tests for heading-numbers.ts.
import { EditorState } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { print } from '../../../hosts/visual-view/visual-view';
import { hasHeadingNumbering, headingNumbers, toggleHeadingNumbering } from './heading-numbers';
import { project } from '../../../hosts/visual-view/test-support';

/** The numbers shown next to the headings of `source`, by heading text. */
function numbers(source: string): Record<string, string> {
  const doc = project(source);
  return Object.fromEntries(headingNumbers(doc).map(({ pos, number }) => [doc.nodeAt(pos)!.textContent, number]));
}

describe('heading numbers', () => {
  it('numbers headings by level once the document sets a numbering', () => {
    const source = '= Intro\n\n#set heading(numbering: "1.1")\n\n= A\n\n== A1\n\n=== A1x\n\n== A2\n\n= B\n\n=== B0\n';
    expect(numbers(source)).toEqual({ A: '1', A1: '1.1', A1x: '1.1.1', A2: '1.2', B: '2', B0: '2.0.1' });
  });

  it('follows the pattern: suffix, letters, Roman numerals', () => {
    expect(numbers('#set heading(numbering: "1.")\n= A\n== B\n')).toEqual({ A: '1.', B: '1.1.' });
    expect(numbers('#set heading(numbering: "I.a)")\n\n= A\n\n== B\n\n= C\n')).toEqual({ A: 'I)', B: 'I.a)', C: 'II)' });
  });

  it('stops numbering (and counting) after numbering: none; later rules win', () => {
    const source = '#set heading(numbering: "1.")\n\n= A\n\n#set heading(numbering: none)\n\n= B\n\n#set heading(numbering: "(a)")\n\n= C\n';
    expect(numbers(source)).toEqual({ A: '1.', C: '(b)' });
  });

  it('counts but shows nothing for function and unknown numberings', () => {
    expect(numbers('#set heading(numbering: (..n) => none)\n\n= A\n')).toEqual({});
    expect(numbers('#set heading(numbering: "一")\n\n= A\n')).toEqual({});
  });

  it('shows nothing without a set rule, and ignores rules nested in content', () => {
    expect(numbers('= A\n\n== B\n')).toEqual({});
    expect(numbers('#[#set heading(numbering: "1.")]\n\n= A\n')).toEqual({});
    expect(numbers('#table(columns: 1, [#set heading(numbering: "1.")])\n\n= A\n')).toEqual({});
  });

  it('reads set rules with other arguments, and the last rule of a block', () => {
    const source = '#set page(width: 10cm)\n#set heading(supplement: [Part], numbering: "A.")\n#set heading(numbering: "1")\n\n= A\n';
    expect(numbers(source)).toEqual({ A: '1' });
  });
});

describe('toggleHeadingNumbering', () => {
  const toggle = (source: string) => {
    const tr = EditorState.create({ doc: project(source) }).tr;
    toggleHeadingNumbering(tr);
    return print(tr.doc);
  };

  it('adds the set rule after the leading code', () => {
    expect(toggle('= A\n')).toBe('#set heading(numbering: "1.")\n\n= A\n');
    expect(toggle('#set page(width: 10cm)\n\n#import "x.typ": y\n\n= A\n')).toBe(
      '#set page(width: 10cm)\n\n#import "x.typ": y\n\n#set heading(numbering: "1.")\n\n= A\n',
    );
  });

  it('removes the numbering rules again, deleting blocks they leave empty', () => {
    expect(toggle('#set heading(numbering: "1.")\n\n= A\n')).toBe('= A\n');
    expect(toggle('#set page(width: 10cm)\n#set heading(numbering: "1.")\n\n= A\n')).toBe('#set page(width: 10cm)\n\n= A\n');
  });

  it('tells whether headings are numbered', () => {
    expect(hasHeadingNumbering(project('#set heading(numbering: "1.")\n\n= A\n'))).toBe(true);
    expect(hasHeadingNumbering(project('#set heading(numbering: none)\n\n= A\n'))).toBe(false);
    expect(hasHeadingNumbering(project('= A\n'))).toBe(false);
  });
});
