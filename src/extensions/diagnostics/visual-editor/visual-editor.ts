// The diagnostics in the Visual editors: each one's text highlighted, the message as tooltip. See ../diagnostics.ts.
import { SourceOffset } from '../../../core/typst-document/typst-document';
import type { SourceHighlight } from '../../../hosts/visual-editor/visual-editor';
import { describeDiagnostic, type SourceDiagnostic } from '../model/model';

/**
 * How the Visual editor marks a diagnostic: its text highlighted, the message as tooltip. An empty range (e.g.
 * "expected expression" at a point) still marks one character.
 */
export function diagnosticHighlight(diagnostic: SourceDiagnostic): SourceHighlight {
  return {
    from: diagnostic.from,
    to: SourceOffset.of(Math.max(diagnostic.to, diagnostic.from + 1)),
    className: 'typst-diagnostics__highlight',
    attributes: { 'data-severity': diagnostic.severity, title: describeDiagnostic(diagnostic) },
  };
}
