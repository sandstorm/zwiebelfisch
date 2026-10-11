// @vitest-environment jsdom
// Tests for workbench.ts.
import { describe, expect, it, vi } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import type { Diagnostic } from '../../../core/typst-engine/typst-engine';
import { summarizeDiagnostics } from '../model/diagnostics-summary';
import { DiagnosticsStatus } from './workbench';
import { SourceOffset } from '../../../core/typst-document/typst-document';

const MAIN = ProjectPath.of('/main.typ');

function diag(overrides: Partial<Diagnostic>): Diagnostic {
  return { severity: 'error', message: 'boom', hints: [], path: MAIN, from: SourceOffset.of(0), to: SourceOffset.of(1), ...overrides };
}

describe('DiagnosticsStatus', () => {
  it('lists the messages of the shown file for hovering over the count, each jumping to its range', () => {
    const parent = document.createElement('div');
    const onJump = vi.fn();
    const status = new DiagnosticsStatus(document, onJump);
    parent.append(status.element);
    status.show(summarizeDiagnostics([diag({ message: 'unknown variable: foo', hints: ['try bar'], from: SourceOffset.of(3), to: SourceOffset.of(6) })], MAIN));
    const details = parent.querySelector<HTMLElement>('.typst-diagnostics__status-details')!;
    expect(details.textContent).toContain('unknown variable: foo');
    expect(details.textContent).toContain('hint: try bar');
    details.querySelector('button')!.click();
    expect(onJump).toHaveBeenCalledWith({ path: MAIN, from: 3, to: 6 });
  });

  it('lists the diagnostics of other files or of none (packages); those in project files jump there', () => {
    const parent = document.createElement('div');
    const onJump = vi.fn();
    const status = new DiagnosticsStatus(document, onJump);
    parent.append(status.element);
    status.show(summarizeDiagnostics([diag({ path: ProjectPath.of('/lib.typ'), from: SourceOffset.of(2), to: SourceOffset.of(4) }), diag({ path: null })], MAIN));
    const items = [...parent.querySelectorAll('.typst-diagnostics__status-elsewhere li')];
    expect(items.map((item) => item.textContent)).toEqual(['/lib.typ: boom', '(no project file): boom']);
    expect(items[1].querySelector('button')).toBeNull();
    items[0].querySelector('button')!.click();
    expect(onJump).toHaveBeenCalledWith({ path: '/lib.typ', from: 2, to: 4 });
  });

  it('has no details while the compile is clean', () => {
    const parent = document.createElement('div');
    const status = new DiagnosticsStatus(document, () => {});
    parent.append(status.element);
    status.show(summarizeDiagnostics([], MAIN));
    expect(parent.querySelector<HTMLElement>('.typst-diagnostics__status-details')!.hidden).toBe(true);
  });
});
