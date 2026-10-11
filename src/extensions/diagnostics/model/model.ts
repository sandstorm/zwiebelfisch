// Each document's diagnostics, and how every editor words one. No DOM, no editor library. See diagnostics in
// ../diagnostics.ts.
import { EventEmitter } from '../../../core/event-emitter/event-emitter';
import type { SourceRange, TypstDocument } from '../../../core/typst-document/typst-document';

/**
 * The diagnostics of each document, for every editor of it (VS Code's DiagnosticCollection).
 */
export class DiagnosticCollection {
  private readonly entries = new WeakMap<TypstDocument, readonly SourceDiagnostic[]>();
  private readonly changed = new EventEmitter<TypstDocument>();
  /** Fires with the document whose diagnostics were set (not when it had none and still has none). */
  readonly onDidChange = this.changed.event;

  /** Replaces the diagnostics of `document` (offsets in its current text). */
  set(document: TypstDocument, diagnostics: readonly SourceDiagnostic[]): void {
    // none before and none now, as after every compile of a document without errors: nothing to tell
    if (diagnostics.length === 0 && this.get(document).length === 0) return;
    this.entries.set(document, diagnostics);
    this.changed.fire(document);
  }

  get(document: TypstDocument): readonly SourceDiagnostic[] {
    return this.entries.get(document) ?? [];
  }
}

/** A compiler diagnostic located in a document's text. */
export interface SourceDiagnostic extends SourceRange {
  severity: 'error' | 'warning';
  message: string;
  hints: string[];
}

/** A diagnostic's message with its hints, one per line, as every editor shows it. */
export function describeDiagnostic(diagnostic: Pick<SourceDiagnostic, 'message' | 'hints'>): string {
  return [diagnostic.message, ...diagnostic.hints.map((hint) => `hint: ${hint}`)].join('\n');
}
