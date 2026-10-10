import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../engine/engine';
import { summarizeDiagnostics } from './diagnostics-summary';

const MAIN = '/main.typ';

function diag(overrides: Partial<Diagnostic>): Diagnostic {
  return { severity: 'error', message: 'boom', hints: [], path: MAIN, from: 0, to: 1, ...overrides };
}

describe('summarizeDiagnostics', () => {
  it('reports a clean compile', () => {
    const summary = summarizeDiagnostics([], MAIN);
    expect(summary).toMatchObject({ severity: 'ok', label: '✓ compiled', target: null, inMain: [], elsewhere: [] });
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

  it('separates diagnostics of the main file from those of other files or without location', () => {
    const own = diag({ from: 3, to: 5 });
    const other = diag({ path: '/lib.typ' });
    const nowhere = diag({ path: null });
    const summary = summarizeDiagnostics([other, own, nowhere], MAIN);
    expect(summary.inMain).toEqual([own]);
    expect(summary.elsewhere).toEqual([other, nowhere]);
  });

  it('targets the earliest error in the main file, preferring errors over warnings', () => {
    const summary = summarizeDiagnostics([
      diag({ severity: 'warning', from: 1, to: 2 }),
      diag({ from: 20, to: 25 }),
      diag({ from: 10, to: 12 }),
      diag({ path: '/lib.typ', from: 0, to: 1 }),
    ], MAIN);
    expect(summary.target).toEqual({ from: 10, to: 12 });
  });

  it('targets the first warning when there are no errors in the main file', () => {
    const summary = summarizeDiagnostics([diag({ severity: 'warning', from: 4, to: 6 })], MAIN);
    expect(summary.target).toEqual({ from: 4, to: 6 });
  });

  it('has no target when all diagnostics are elsewhere', () => {
    expect(summarizeDiagnostics([diag({ path: '/lib.typ' })], MAIN).target).toBeNull();
  });
});
