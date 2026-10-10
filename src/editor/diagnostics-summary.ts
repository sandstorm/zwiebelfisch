import type { Diagnostic } from '../engine/engine';

export interface DiagnosticsSummary {
  severity: 'ok' | 'warning' | 'error';
  /** Short status text, e.g. "✓ compiled" or "1 error, 2 warnings". */
  label: string;
  /** The range to jump to on click: the earliest error (else warning) in the main file. */
  target: { from: number; to: number } | null;
  /** Diagnostics that can be marked in the main file's editor. */
  inMain: Diagnostic[];
  /** Diagnostics in other files or without location: only listed in the status. */
  elsewhere: Diagnostic[];
}

/** Condenses one compilation's diagnostics into what the status indicator shows. */
export function summarizeDiagnostics(diagnostics: Diagnostic[], main: string): DiagnosticsSummary {
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  const inMain = diagnostics.filter((d) => d.path === main);
  return {
    severity: errors > 0 ? 'error' : warnings > 0 ? 'warning' : 'ok',
    label: diagnostics.length === 0
      ? '✓ compiled'
      : [count(errors, 'error'), count(warnings, 'warning')].filter(Boolean).join(', '),
    target: firstTarget(inMain),
    inMain,
    elsewhere: diagnostics.filter((d) => d.path !== main),
  };
}

function count(n: number, noun: string): string {
  if (n === 0) return '';
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function firstTarget(diagnostics: Diagnostic[]): DiagnosticsSummary['target'] {
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const candidates = errors.length > 0 ? errors : diagnostics;
  if (candidates.length === 0) return null;
  const first = candidates.reduce((a, b) => (b.from < a.from ? b : a));
  return { from: first.from, to: first.to };
}
