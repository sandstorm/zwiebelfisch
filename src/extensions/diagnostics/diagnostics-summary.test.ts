// Tests for diagnostics-summary.ts.
import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../core/typst-engine/typst-engine';
import { summarizeDiagnostics } from './diagnostics-summary';

const MAIN = '/main.typ';

function diag(overrides: Partial<Diagnostic>): Diagnostic {
  return { severity: 'error', message: 'boom', hints: [], path: MAIN, from: 0, to: 1, ...overrides };
}

describe('summarizeDiagnostics', () => {
  it('reports a clean compile', () => {
    const summary = summarizeDiagnostics([], MAIN);
    expect(summary).toMatchObject({ severity: 'ok', label: '✓ compiled', target: null, inFile: [], elsewhere: [] });
  });

  it('counts errors and warnings with correct plurals', () => {
    expect(summarizeDiagnostics([diag({})], MAIN).label).toBe('1 error');
    expect(summarizeDiagnostics([diag({}), diag({})], MAIN).label).toBe('2 errors');
    expect(summarizeDiagnostics([diag({ severity: 'warning' })], MAIN).label).toBe('1 warning');
    expect(summarizeDiagnostics([diag({}), diag({ severity: 'warning' }), diag({ severity: 'warning' })], MAIN).label)
      .toBe('1 error, 2 warnings');
  });

  it('is an error when any error exists, a warning when only warnings exist', () => {
    expect(summarizeDiagnostics([diag({ severity: 'warning' }), diag({})], MAIN).severity).toBe('error');
    expect(summarizeDiagnostics([diag({ severity: 'warning' })], MAIN).severity).toBe('warning');
  });

  it('separates diagnostics of the shown file from those of other files or without location', () => {
    const own = diag({ from: 3, to: 5 });
    const other = diag({ path: '/lib.typ' });
    const nowhere = diag({ path: null });
    const summary = summarizeDiagnostics([other, own, nowhere], MAIN);
    expect(summary.inFile).toEqual([own]);
    expect(summary.elsewhere).toEqual([other, nowhere]);
  });

  it('targets the earliest error in the shown file, preferring errors over warnings', () => {
    const summary = summarizeDiagnostics([
      diag({ severity: 'warning', from: 1, to: 2 }),
      diag({ from: 20, to: 25 }),
      diag({ from: 10, to: 12 }),
      diag({ path: '/lib.typ', from: 0, to: 1 }),
    ], MAIN);
    expect(summary.target).toEqual({ path: MAIN, from: 10, to: 12 });
  });

  it('targets the first warning when there are no errors in the shown file', () => {
    const summary = summarizeDiagnostics([diag({ severity: 'warning', from: 4, to: 6 })], MAIN);
    expect(summary.target).toEqual({ path: MAIN, from: 4, to: 6 });
  });

  it('targets an error in another project file before a warning in the shown one', () => {
    const summary = summarizeDiagnostics([
      diag({ severity: 'warning', from: 1, to: 2 }),
      diag({ path: '/lib.typ', from: 9, to: 11 }),
      diag({ path: '/lib.typ', from: 3, to: 4 }),
    ], MAIN);
    expect(summary.target).toEqual({ path: '/lib.typ', from: 3, to: 4 });
  });

  it('summarizes for the file that is shown', () => {
    const summary = summarizeDiagnostics([diag({}), diag({ path: '/lib.typ', from: 5, to: 6 })], '/lib.typ');
    expect(summary.inFile).toEqual([diag({ path: '/lib.typ', from: 5, to: 6 })]);
    expect(summary.target).toEqual({ path: '/lib.typ', from: 5, to: 6 });
  });

  it('has no target when all diagnostics are in packages or without location', () => {
    expect(summarizeDiagnostics([diag({ path: '@preview/x:1.0.0/lib.typ' }), diag({ path: null })], MAIN).target).toBeNull();
  });
});
