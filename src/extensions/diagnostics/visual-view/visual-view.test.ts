// Tests for visual-view.ts.
import { describe, expect, it } from 'vitest';
import { diagnosticHighlight } from './visual-view';

const error = { severity: 'error' as const, message: 'unknown variable: foo', hints: ['try bar'], from: 3, to: 6 };

describe('diagnosticHighlight', () => {
  it('marks the range with the severity and the message as tooltip', () => {
    expect(diagnosticHighlight(error)).toEqual({
      from: 3,
      to: 6,
      className: 'typst-diagnostics__highlight',
      attributes: { 'data-severity': 'error', title: 'unknown variable: foo\nhint: try bar' },
    });
  });

  it('marks one character of an empty range', () => {
    expect(diagnosticHighlight({ ...error, from: 4, to: 4 })).toMatchObject({ from: 4, to: 5 });
  });
});
