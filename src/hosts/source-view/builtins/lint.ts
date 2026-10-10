// lint: compile diagnostics underlined in the Source views (CodeMirror lint), and their wording. See builtins.ts.
import { type Diagnostic as LintDiagnostic, setDiagnostics } from '@codemirror/lint';
import { type EditorView, ViewPlugin } from '@codemirror/view';
import { Disposable } from '../../../core/disposable/disposable';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import type { SourceViewExtension } from '../contribution';

/** A compiler diagnostic located in the text shown by a SourceView (UTF-16 offsets). */
export interface SourceDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  hints: string[];
  from: number;
  to: number;
}

/**
 * Underlines the diagnostics `diagnostics` holds for a view's document, with the message and hints on
 * hover; they follow later edits until the document's diagnostics are set again.
 */
export function lint(diagnostics: DiagnosticCollection): SourceViewExtension {
  return ({ document }) => ViewPlugin.define((view) => new LintShown(view, document, diagnostics));
}

/** The diagnostics of each document, for every Source view of it (VS Code's DiagnosticCollection). */
export class DiagnosticCollection {
  private readonly entries = new WeakMap<TypstDocument, readonly SourceDiagnostic[]>();
  private readonly listeners = new Set<(document: TypstDocument) => void>();

  /** Replaces the diagnostics of `document` (offsets in its current text). */
  set(document: TypstDocument, diagnostics: readonly SourceDiagnostic[]): void {
    this.entries.set(document, diagnostics);
    for (const listener of this.listeners) listener(document);
  }

  get(document: TypstDocument): readonly SourceDiagnostic[] {
    return this.entries.get(document) ?? [];
  }

  onDidChange(listener: (document: TypstDocument) => void): Disposable {
    this.listeners.add(listener);
    return new Disposable(() => this.listeners.delete(listener));
  }
}

/** Keeps one view's lint diagnostics those of its document. */
class LintShown {
  private readonly subscription: Disposable;
  private destroyed = false;

  constructor(
    private readonly view: EditorView,
    private readonly document: TypstDocument,
    private readonly diagnostics: DiagnosticCollection,
  ) {
    this.subscription = diagnostics.onDidChange((changed) => {
      if (changed === document) this.show();
    });
    // Later: a view may not dispatch while it is being built.
    if (diagnostics.get(document).length > 0) queueMicrotask(() => this.show());
  }

  destroy(): void {
    this.destroyed = true;
    this.subscription.dispose();
  }

  private show(): void {
    if (this.destroyed) return;
    const { state } = this.view;
    this.view.dispatch(setDiagnostics(state, toLintDiagnostics(this.diagnostics.get(this.document), state.doc.length)));
  }
}

/** Converts compiler diagnostics to CodeMirror lint diagnostics, hints folded into the message. */
export function toLintDiagnostics(diagnostics: readonly SourceDiagnostic[], length: number): LintDiagnostic[] {
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
