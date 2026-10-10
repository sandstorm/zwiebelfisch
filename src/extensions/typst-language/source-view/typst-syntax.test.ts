// Tests for typst-syntax.ts.
import { ensureSyntaxTree, getIndentation } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { typstLanguage } from './typst-syntax';

/** The indentation of a new line inserted at the `|` in `doc`. */
function indentAt(doc: string): number | null {
  const pos = doc.indexOf('|');
  const text = doc.slice(0, pos) + doc.slice(pos + 1);
  const state = EditorState.create({ doc: text, extensions: typstLanguage() });
  ensureSyntaxTree(state, text.length, 5000);
  return getIndentation(state, pos);
}

describe('typstLanguage indentation', () => {
  it('does not indent the line after a call closed at the end of the line', () => {
    expect(indentAt('#set page(width: 16cm, margin: 1.5cm)|\n#set text(size: 12pt)')).toBe(0);
    expect(indentAt('#figure[x]|\n')).toBe(0);
  });

  it('keeps the indentation of the enclosing block after a closed call', () => {
    expect(indentAt('#block[\n  #set text(size: 9pt)|\n]')).toBe(2);
  });

  it('still aligns continuation lines inside an open call', () => {
    expect(indentAt('#set page(width: 16cm,|')).toBe(10);
  });
});
