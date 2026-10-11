// Tests for diagnostics-summary.ts.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import type { Diagnostic } from '../../../core/typst-engine/typst-engine';
import { summarizeDiagnostics } from './diagnostics-summary';
import { SourceOffset, SourceRange } from '../../../core/typst-document/typst-document';

const MAIN = ProjectPath.of('/main.typ');
const LIB = ProjectPath.of('/lib.typ');

function diag(overrides: Partial<Diagnostic>): Diagnostic {
  return { severity: 'error', message: 'boom', hints: [], path: MAIN, from: SourceOffset.of(0), to: SourceOffset.of(1), ...overrides };
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
    const own = diag(SourceRange.of({ from: 3, to: 5 }));
    const other = diag({ path: LIB });
    const nowhere = diag({ path: null });
    const summary = summarizeDiagnostics([other, own, nowhere], MAIN);
    expect(summary.inFile).toEqual([own]);
    expect(summary.elsewhere).toEqual([other, nowhere]);
  });

  it('targets the earliest error in the shown file, preferring errors over warnings', () => {
    const summary = summarizeDiagnostics([
      diag({ severity: 'warning', from: SourceOffset.of(1), to: SourceOffset.of(2) }),
      diag(SourceRange.of({ from: 20, to: 25 })),
      diag(SourceRange.of({ from: 10, to: 12 })),
      diag({ path: LIB, from: SourceOffset.of(0), to: SourceOffset.of(1) }),
    ], MAIN);
    expect(summary.target).toEqual({ path: MAIN, from: 10, to: 12 });
  });

  it('targets the first warning when there are no errors in the shown file', () => {
    const summary = summarizeDiagnostics([diag({ severity: 'warning', from: SourceOffset.of(4), to: SourceOffset.of(6) })], MAIN);
    expect(summary.target).toEqual({ path: MAIN, from: 4, to: 6 });
  });

  it('targets an error in another project file before a warning in the shown one', () => {
    const summary = summarizeDiagnostics([
      diag({ severity: 'warning', from: SourceOffset.of(1), to: SourceOffset.of(2) }),
      diag({ path: LIB, from: SourceOffset.of(9), to: SourceOffset.of(11) }),
      diag({ path: LIB, from: SourceOffset.of(3), to: SourceOffset.of(4) }),
    ], MAIN);
    expect(summary.target).toEqual({ path: LIB, from: 3, to: 4 });
  });

  it('summarizes for the file that is shown', () => {
    const summary = summarizeDiagnostics([diag({}), diag({ path: LIB, from: SourceOffset.of(5), to: SourceOffset.of(6) })], LIB);
    expect(summary.inFile).toEqual([diag({ path: LIB, from: SourceOffset.of(5), to: SourceOffset.of(6) })]);
    expect(summary.target).toEqual({ path: LIB, from: 5, to: 6 });
  });

  it('has no target when no diagnostic is in a project file', () => {
    expect(summarizeDiagnostics([diag({ path: null })], MAIN).target).toBeNull();
  });
});
