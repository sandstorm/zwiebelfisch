// summarizeDiagnostics: compile diagnostics counted and sorted per file. See model.ts.
import { ProjectPath } from '../../../core/paths/paths';
import type { Diagnostic } from '../../../core/typst-engine/typst-engine';

/** A range in a project file. */
export interface DiagnosticTarget {
  path: ProjectPath;
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
  /** Diagnostics of the shown file: listed behind the status, each jumping to its range. */
  inFile: Diagnostic[];
  /** Diagnostics in other files or without location: only listed in the status. */
  elsewhere: Diagnostic[];
}

/** Condenses one compilation's diagnostics into what the status indicator shows while `file` is open. */
export function summarizeDiagnostics(diagnostics: readonly Diagnostic[], file: ProjectPath): DiagnosticsSummary {
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

/** Where a diagnostic is in the project; null in a package file or without location (the engine's path is a string). */
export function targetOf({ path, from, to }: Diagnostic): DiagnosticTarget | null {
  const projectPath = path === null ? null : ProjectPath.parse(path);
  return projectPath && { path: projectPath, from, to };
}

function count(n: number, noun: string): string {
  if (n === 0) return '';
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function firstTarget(diagnostics: readonly Diagnostic[], file: ProjectPath): DiagnosticTarget | null {
  for (const severity of ['error', 'warning']) {
    const candidates = diagnostics.flatMap((d) => (d.severity === severity ? (targetOf(d) ?? []) : []));
    const inFile = candidates.filter((target) => target.path === file);
    const pool = inFile.length > 0 ? inFile : candidates.filter((target) => target.path === candidates[0]?.path);
    if (pool.length === 0) continue;
    return pool.reduce((a, b) => (b.from < a.from ? b : a));
  }
  return null;
}
