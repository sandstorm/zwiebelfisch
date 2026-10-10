import type { Diagnostic as LintDiagnostic } from '@codemirror/lint';

/** A compiler diagnostic located in the text shown by a SourceView (UTF-16 offsets). */
export interface SourceDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  hints: string[];
  from: number;
  to: number;
}

/** Converts compiler diagnostics to CodeMirror lint diagnostics, hints folded into the message. */
export function toLintDiagnostics(diagnostics: SourceDiagnostic[], length: number): LintDiagnostic[] {
  return diagnostics.map((d) => ({
    from: Math.min(d.from, length),
    to: Math.min(d.to, length),
    severity: d.severity,
    message: describeDiagnostic(d),
    source: 'typst',
  }));
}

/** A diagnostic's message with its hints, one per line, as every view shows it. */
export function describeDiagnostic(diagnostic: Pick<SourceDiagnostic, 'message' | 'hints'>): string {
  return [diagnostic.message, ...diagnostic.hints.map((hint) => `hint: ${hint}`)].join('\n');
}
