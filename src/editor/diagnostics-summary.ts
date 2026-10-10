import type { Diagnostic } from '../core/typst-engine/typst-engine';

/** A range in a project file. */
export interface DiagnosticTarget {
  path: string;
  from: number;
  to: number;
}

export interface DiagnosticsSummary {
  severity: 'ok' | 'warning' | 'error';
  /** Short status text, e.g. "✓ compiled" or "1 error, 2 warnings". */
  label: string;
  /**
   * The range to jump to on click: the earliest error in the shown file, else
   * in another project file, else the same for warnings.
   */
  target: DiagnosticTarget | null;
  /** Diagnostics that can be marked in the shown file's editor. */
  inFile: Diagnostic[];
  /** Diagnostics in other files or without location: only listed in the status. */
  elsewhere: Diagnostic[];
}

/** Condenses one compilation's diagnostics into what the status indicator shows while `file` is open. */
export function summarizeDiagnostics(diagnostics: Diagnostic[], file: string): DiagnosticsSummary {
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  return {
    severity: errors > 0 ? 'error' : warnings > 0 ? 'warning' : 'ok',
    label: diagnostics.length === 0
      ? '✓ compiled'
      : [count(errors, 'error'), count(warnings, 'warning')].filter(Boolean).join(', '),
    target: firstTarget(diagnostics, file),
    inFile: diagnostics.filter((d) => d.path === file),
    elsewhere: diagnostics.filter((d) => d.path !== file),
  };
}

/** Whether a diagnostic's path is a project file (not a package file, not missing). */
export function inProject(path: string | null): path is string {
  return path?.startsWith('/') ?? false;
}

function count(n: number, noun: string): string {
  if (n === 0) return '';
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function firstTarget(diagnostics: Diagnostic[], file: string): DiagnosticTarget | null {
  for (const severity of ['error', 'warning']) {
    const candidates = diagnostics.filter((d) => d.severity === severity && inProject(d.path));
    const inFile = candidates.filter((d) => d.path === file);
    const pool = inFile.length > 0 ? inFile : candidates.filter((d) => d.path === candidates[0]?.path);
    if (pool.length === 0) continue;
    const first = pool.reduce((a, b) => (b.from < a.from ? b : a));
    return { path: first.path!, from: first.from, to: first.to };
  }
  return null;
}
