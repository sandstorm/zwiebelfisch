// The diagnostics in the Visual views: each one's text highlighted, the message as tooltip. See ../diagnostics.ts.
import type { Highlight } from '../../../hosts/visual-view/visual-view';
import { describeDiagnostic, type SourceDiagnostic } from '../model/model';

/**
 * How the Visual view marks a diagnostic: its text highlighted, the message as tooltip. An empty range (e.g.
 * "expected expression" at a point) still marks one character.
 */
export function diagnosticHighlight(diagnostic: SourceDiagnostic): Highlight {
  return {
    from: diagnostic.from,
    to: Math.max(diagnostic.to, diagnostic.from + 1),
    className: 'typst-diagnostics__highlight',
    attributes: { 'data-severity': diagnostic.severity, title: describeDiagnostic(diagnostic) },
  };
}
