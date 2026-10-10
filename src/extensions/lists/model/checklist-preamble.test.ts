// Tests for checklist-preamble.ts.
import { describe, expect, it } from 'vitest';
import { calculateChecklistPreambleChange, CHECKLIST_PREAMBLE } from './checklist-preamble';

describe('calculateChecklistPreambleChange', () => {
  it('adds the whole preamble at the top of a document without it', () => {
    expect(calculateChecklistPreambleChange([])).toEqual({ after: null, code: CHECKLIST_PREAMBLE });
    expect(calculateChecklistPreambleChange(['#set page(width: 10cm)'])).toEqual({ after: null, code: CHECKLIST_PREAMBLE });
  });

  it('adds the show rule right after an existing import, and the import before an existing show rule', () => {
    expect(calculateChecklistPreambleChange(['#let x = 1', '#import "@preview/cheq:0.2.2": *'])).toEqual({ after: 1, code: '#show: checklist' });
    expect(calculateChecklistPreambleChange(['#show: checklist.with(fill: luma(95%))'])).toEqual({
      after: null,
      code: '#import "@preview/cheq:0.4.0": checklist',
    });
  });

  it('changes nothing when both are there', () => {
    expect(calculateChecklistPreambleChange([CHECKLIST_PREAMBLE])).toBeNull();
    expect(calculateChecklistPreambleChange(['#import "@preview/cheq:0.4.0": checklist, other', '#show: checklist'])).toBeNull();
  });
});
