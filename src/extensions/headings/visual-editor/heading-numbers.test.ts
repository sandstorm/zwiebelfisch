// @vitest-environment jsdom
// Tests for heading-numbers.ts: the numbers the Visual editor shows next to headings.
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { createVisualEditor } from '../../../testing/testing';

// jsdom lacks layout; ProseMirror only needs these to exist.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();

/** The numbers shown next to the headings of `source`, by heading text. */
function numbers(source: string): Record<string, string> {
  const parent = document.body.appendChild(document.createElement('div'));
  createVisualEditor(parent, new TypstDocument(source));
  return Object.fromEntries([...parent.querySelectorAll('[data-heading-number]')].map((h) => [h.textContent, h.getAttribute('data-heading-number')!]));
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

describe('the numbered layout', () => {
  it('gives the editor room for the numbers while any heading shows one', () => {
    const parent = document.body.appendChild(document.createElement('div'));
    const doc = new TypstDocument('= A\n');
    createVisualEditor(parent, doc);
    const editor = parent.querySelector('.ProseMirror')!;
    expect(editor.classList.contains('typst-headings--numbered')).toBe(false);
    doc.setText('#set heading(numbering: "1.")\n\n= A\n', 'test');
    expect(editor.classList.contains('typst-headings--numbered')).toBe(true);
  });
});
