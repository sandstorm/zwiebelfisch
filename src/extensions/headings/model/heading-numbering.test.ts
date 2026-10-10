// Tests for heading-numbering.ts.
import { describe, expect, it } from 'vitest';
import { HeadingCounter, numbersHeadings, withoutHeadingNumbering } from './heading-numbering';

describe('HeadingCounter', () => {
  it('counts nothing before a rule numbers headings, then counts by level', () => {
    const counter = new HeadingCounter();
    expect(counter.count(1)).toBeNull();
    counter.readRules('#set page(width: 10cm)\n#set heading(numbering: "1.1")');
    expect([counter.count(1), counter.count(2), counter.count(3), counter.count(1), counter.count(3)]).toEqual(['1', '1.1', '1.1.1', '2', '2.0.1']);
  });

  it('keeps counting, but shows nothing, for numberings it cannot format', () => {
    const counter = new HeadingCounter();
    counter.readRules('#set heading(numbering: (..n) => none)');
    expect(counter.count(1)).toBeNull();
    counter.readRules('#set heading(numbering: "1.")');
    expect(counter.count(1)).toBe('2.');
  });

  it('keeps the numbering through code without heading rules', () => {
    const counter = new HeadingCounter();
    counter.readRules('#set heading(numbering: "I.")');
    counter.readRules('#let x = 1');
    expect(counter.count(1)).toBe('I.');
  });
});

describe('numbersHeadings', () => {
  it('reads the last numbering rule of the code', () => {
    expect(numbersHeadings('#set heading(numbering: "1.")')).toBe(true);
    expect(numbersHeadings('#set heading(numbering: "1.")\n#set heading(numbering: none)')).toBe(false);
    expect(numbersHeadings('#set heading(supplement: [Part])')).toBe(false);
  });
});

describe('withoutHeadingNumbering', () => {
  it('removes a rule that only sets the numbering, with its line', () => {
    expect(withoutHeadingNumbering('#set heading(numbering: "1.")')).toBe('');
    expect(withoutHeadingNumbering('#set page(width: 10cm)\n#set heading(numbering: "1.")\n#let x = 1')).toBe('#set page(width: 10cm)\n#let x = 1');
    expect(withoutHeadingNumbering('#set page(width: 10cm)\n#set heading(numbering: "1.")')).toBe('#set page(width: 10cm)');
  });

  it('keeps the other arguments of a rule', () => {
    expect(withoutHeadingNumbering('#set heading(numbering: "1.", supplement: [Part])')).toBe('#set heading(supplement: [Part])');
    expect(withoutHeadingNumbering('#set heading(outlined: false, numbering: (..n) => f(n, 1))')).toBe('#set heading(outlined: false)');
  });
});
