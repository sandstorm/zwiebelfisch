// The diagnostics' read model: each document's compile diagnostics (DiagnosticCollection), how every view words
// one, and the status summary (diagnostics-summary.ts). No DOM, no editor library. Entry of
// diagnostics/model/. See ../diagnostics.ts.
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import type { TypstDocument } from '../../../core/typst-document/typst-document';

export { inProject, summarizeDiagnostics, type DiagnosticTarget, type DiagnosticsSummary } from './diagnostics-summary';

/** A compiler diagnostic located in a document's text (UTF-16 offsets). */
export interface SourceDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  hints: string[];
  from: number;
  to: number;
}

/** The diagnostics of each document, for every view of it (VS Code's DiagnosticCollection). */
export class DiagnosticCollection {
  private readonly entries = new WeakMap<TypstDocument, readonly SourceDiagnostic[]>();
  private readonly changed = new EventEmitter<TypstDocument>();
  /** Fires with the document whose diagnostics were set. */
  readonly onDidChange = this.changed.event;

  /** Replaces the diagnostics of `document` (offsets in its current text). */
  set(document: TypstDocument, diagnostics: readonly SourceDiagnostic[]): void {
    this.entries.set(document, diagnostics);
    this.changed.fire(document);
  }

  get(document: TypstDocument): readonly SourceDiagnostic[] {
    return this.entries.get(document) ?? [];
  }
}

/** A diagnostic's message with its hints, one per line, as every view shows it. */
export function describeDiagnostic(diagnostic: Pick<SourceDiagnostic, 'message' | 'hints'>): string {
  return [diagnostic.message, ...diagnostic.hints.map((hint) => `hint: ${hint}`)].join('\n');
}
