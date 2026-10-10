// Tests for model.ts: the diagnostics of each document, and how the views word and mark one.
import { describe, expect, it } from 'vitest';
import { TypstDocument } from '../../../core/typst-document/typst-document';
import { DiagnosticCollection, describeDiagnostic, diagnosticHighlight } from './model';

const error = { severity: 'error' as const, message: 'unknown variable: foo', hints: ['try bar'], from: 3, to: 6 };

describe('DiagnosticCollection', () => {
  it('keeps the diagnostics per document and tells which one changed', () => {
    const collection = new DiagnosticCollection();
    const one = new TypstDocument('one\n');
    const two = new TypstDocument('two\n');
    const changed: TypstDocument[] = [];
    collection.onDidChange((document) => changed.push(document));
    collection.set(one, [error]);
    expect(collection.get(one)).toEqual([error]);
    expect(collection.get(two)).toEqual([]);
    expect(changed).toEqual([one]);
  });
});

describe('describeDiagnostic', () => {
  it('puts each hint on a line of its own after the message', () => {
    expect(describeDiagnostic(error)).toBe('unknown variable: foo\nhint: try bar');
  });
});

describe('diagnosticHighlight', () => {
  it('marks the range with the severity and the message as tooltip', () => {
    expect(diagnosticHighlight(error)).toEqual({
      from: 3,
      to: 6,
      className: 'typst-diagnostic',
      attributes: { 'data-severity': 'error', title: 'unknown variable: foo\nhint: try bar' },
    });
  });

  it('marks one character of an empty range', () => {
    expect(diagnosticHighlight({ ...error, from: 4, to: 4 })).toMatchObject({ from: 4, to: 5 });
  });
});
