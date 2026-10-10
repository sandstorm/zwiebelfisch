// lint: the diagnostics' part of the Source views: compile diagnostics underlined (CodeMirror lint). See ../diagnostics.ts.
import { type Diagnostic as LintDiagnostic, setDiagnostics } from '@codemirror/lint';
import { type EditorView, ViewPlugin } from '@codemirror/view';
import type { Disposable } from '../../../core/disposable/disposable';
import type { TypstDocument } from '../../../core/typst-document/typst-document';
import type { SourceViewExtension } from '../../../hosts/source-view/source-view';
import { describeDiagnostic, type DiagnosticCollection, type SourceDiagnostic } from '../model/model';

/**
 * Underlines the diagnostics `diagnostics` holds for a view's document, with the message and hints on
 * hover; they follow later edits until the document's diagnostics are set again.
 */
export function lint(diagnostics: DiagnosticCollection): SourceViewExtension {
  return ({ document }) => ViewPlugin.define((view) => new LintShown(view, document, diagnostics));
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
function toLintDiagnostics(diagnostics: readonly SourceDiagnostic[], length: number): LintDiagnostic[] {
  return diagnostics.map((d) => ({
    from: Math.min(d.from, length),
    to: Math.min(d.to, length),
    severity: d.severity,
    message: describeDiagnostic(d),
    source: 'typst',
  }));
}
