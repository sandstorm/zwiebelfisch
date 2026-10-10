// @vitest-environment jsdom
// Tests for diagnostics.ts.
import { describe, expect, it, vi } from 'vitest';
import type { Diagnostic } from '../../core/typst-engine/typst-engine';
import { DiagnosticsStatus } from './diagnostics';
import { summarizeDiagnostics } from './diagnostics-summary';

const MAIN = '/main.typ';

function diag(overrides: Partial<Diagnostic>): Diagnostic {
  return { severity: 'error', message: 'boom', hints: [], path: MAIN, from: 0, to: 1, ...overrides };
}

describe('DiagnosticsStatus', () => {
  it('lists the messages of the shown file for hovering over the count, each jumping to its range', () => {
    const parent = document.createElement('div');
    const onJump = vi.fn();
    const status = new DiagnosticsStatus(parent, onJump);
    status.show(summarizeDiagnostics([diag({ message: 'unknown variable: foo', hints: ['try bar'], from: 3, to: 6 })], MAIN));
    const details = parent.querySelector<HTMLElement>('.typst-status__details')!;
    expect(details.textContent).toContain('unknown variable: foo');
    expect(details.textContent).toContain('hint: try bar');
    details.querySelector('button')!.click();
    expect(onJump).toHaveBeenCalledWith({ path: MAIN, from: 3, to: 6 });
  });

  it('has no details while the compile is clean', () => {
    const parent = document.createElement('div');
    const status = new DiagnosticsStatus(parent, () => {});
    status.show(summarizeDiagnostics([], MAIN));
    expect(parent.querySelector<HTMLElement>('.typst-status__details')!.hidden).toBe(true);
  });
});
