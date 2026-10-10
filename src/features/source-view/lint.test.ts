// Tests for lint.ts.
import { describe, expect, it } from 'vitest';
import { toLintDiagnostics } from './lint';

const base = { severity: 'error' as const, message: 'unknown variable: unknown', hints: [], from: 1, to: 8 };

describe('toLintDiagnostics', () => {
  it('keeps range, severity and message', () => {
    expect(toLintDiagnostics([base], 20)).toEqual([
      { from: 1, to: 8, severity: 'error', message: 'unknown variable: unknown', source: 'typst' },
    ]);
  });

  it('appends hints to the message', () => {
    const [result] = toLintDiagnostics([{ ...base, hints: ['did you mean `known`?', 'or this'] }], 20);
    expect(result.message).toBe('unknown variable: unknown\nhint: did you mean `known`?\nhint: or this');
  });

  it('clamps ranges to the document length', () => {
    const [result] = toLintDiagnostics([{ ...base, from: 15, to: 30 }], 10);
    expect(result).toMatchObject({ from: 10, to: 10 });
  });

  it('keeps warnings as warnings', () => {
    const [result] = toLintDiagnostics([{ ...base, severity: 'warning' }], 20);
    expect(result.severity).toBe('warning');
  });
});
