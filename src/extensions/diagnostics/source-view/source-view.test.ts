// @vitest-environment jsdom
// Tests for source-view.ts.
import { forEachDiagnostic, type Diagnostic as LintDiagnostic } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { SourceViewHost } from '../../../hosts/source-view/source-view';
import { DiagnosticCollection } from '../model/model';
import { lint } from './source-view';

const base = { severity: 'error' as const, message: 'unknown variable: unknown', hints: [], from: 1, to: 8 };

describe('lint in the Source views', () => {
  function setup(diagnostics: DiagnosticCollection, document: TypstDocument) {
    const host = new SourceViewHost();
    host.registerCodeMirrorExtension(lint(diagnostics));
    const parent = window.document.body.appendChild(window.document.createElement('div'));
    host.createView(parent, document);
    return () => [...parent.querySelectorAll('.cm-lintRange-error')].map((range) => range.textContent);
  }

  /** The lint diagnostics of the view in `parent`. */
  function shown(parent: HTMLElement): LintDiagnostic[] {
    const view = EditorView.findFromDOM(parent.querySelector<HTMLElement>('.cm-editor')!)!;
    const found: LintDiagnostic[] = [];
    forEachDiagnostic(view.state, (diagnostic, from, to) => found.push({ ...diagnostic, from, to }));
    return found;
  }

  it("underlines its document's diagnostics, and only those", () => {
    const diagnostics = new DiagnosticCollection();
    const document = new TypstDocument('#unknown + 1\n');
    const errors = setup(diagnostics, document);
    diagnostics.set(new TypstDocument('#other\n'), [base]);
    expect(errors()).toEqual([]);
    diagnostics.set(document, [base]);
    expect(errors()).toEqual(['unknown']);
    diagnostics.set(document, []);
    expect(errors()).toEqual([]);
  });

  it('shows diagnostics set before the view was made', async () => {
    const diagnostics = new DiagnosticCollection();
    const document = new TypstDocument('#unknown + 1\n');
    diagnostics.set(document, [base]);
    const errors = setup(diagnostics, document);
    await Promise.resolve();
    expect(errors()).toEqual(['unknown']);
  });

  it('keeps severity, folds the hints into the message, and clamps ranges to the text', () => {
    const diagnostics = new DiagnosticCollection();
    const document = new TypstDocument('#unknown\n');
    const parent = window.document.body.appendChild(window.document.createElement('div'));
    const host = new SourceViewHost();
    host.registerCodeMirrorExtension(lint(diagnostics));
    host.createView(parent, document);
    diagnostics.set(document, [{ ...base, severity: 'warning', hints: ['did you mean `known`?', 'or this'], from: 5, to: 30 }]);
    expect(shown(parent)).toEqual([
      expect.objectContaining({ from: 5, to: 9, severity: 'warning', message: 'unknown variable: unknown\nhint: did you mean `known`?\nhint: or this' }),
    ]);
  });
});
