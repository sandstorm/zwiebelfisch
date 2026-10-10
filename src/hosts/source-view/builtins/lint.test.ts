// @vitest-environment jsdom
// Tests for lint.ts.
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { SourceViewHost } from '../source-view';
import { DiagnosticCollection, lint, toLintDiagnostics } from './lint';

const base = { severity: 'error' as const, message: 'unknown variable: unknown', hints: [], from: 1, to: 8 };

describe('toLintDiagnostics', () => {
  it('keeps range, severity and message', () => {
    expect(toLintDiagnostics([base], 20)).toEqual([
      { from: 1, to: 8, severity: 'error', message: 'unknown variable: unknown', source: 'typst' },
    ]);
  });

  it('appends hints to the message', () => {
    const [result] = toLintDiagnostics([{ ...base, hints: ['did you mean `known`?', 'or this'] }], 20);
    expect(result.message).toBe('unknown variable: unknown\nhint: did you mean `known`?\nhint: or this');
  });

  it('clamps ranges to the document length', () => {
    const [result] = toLintDiagnostics([{ ...base, from: 15, to: 30 }], 10);
    expect(result).toMatchObject({ from: 10, to: 10 });
  });

  it('keeps warnings as warnings', () => {
    const [result] = toLintDiagnostics([{ ...base, severity: 'warning' }], 20);
    expect(result.severity).toBe('warning');
  });
});

describe('lint in the Source views', () => {
  function setup(diagnostics: DiagnosticCollection, document: TypstDocument) {
    const host = new SourceViewHost();
    host.registerExtension(lint(diagnostics));
    const parent = window.document.body.appendChild(window.document.createElement('div'));
    host.createView(parent, document);
    return () => [...parent.querySelectorAll('.cm-lintRange-error')].map((range) => range.textContent);
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
});
