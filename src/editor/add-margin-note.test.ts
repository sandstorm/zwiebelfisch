import { describe, expect, it } from 'vitest';
import type { TextChange } from '../document/typst-document';
import { addMarginNote } from './add-margin-note';

const IMPORT = '#import "@preview/drafting:0.2.2": margin-note\n';

/** Applies `changes` (pre-change coordinates) like TypstDocument.change. */
function apply(text: string, changes: readonly TextChange[]): string {
  return [...changes].sort((a, b) => b.from - a.from).reduce((t, c) => t.slice(0, c.from) + c.insert + t.slice(c.to), text);
}

/** The text after adding a note at `from..to`, with `|` where the note's body starts. */
function noted(text: string, from: number, to = from): string {
  const result = addMarginNote(text, { from, to });
  if (!result) return 'null';
  const after = apply(text, result.changes);
  return `${after.slice(0, result.note)}|${after.slice(result.note)}`;
}

describe('addMarginNote', () => {
  it('inserts a point note at a collapsed cursor and the import at the top', () => {
    expect(noted('Hello world\n', 5)).toBe(`${IMPORT}Hello#margin-note[|] world\n`);
  });

  it('wraps a selection as the highlighted text of a range note', () => {
    expect(noted('Hello world\n', 6, 11)).toBe(`${IMPORT}Hello #margin-note[world][|]\n`);
  });

  it('wraps formatted text when the selection is balanced markup', () => {
    expect(noted('A *bold* claim.\n', 2, 14)).toBe(`${IMPORT}A #margin-note[*bold* claim][|].\n`);
  });

  it('falls back to a point note at the end when the selection cuts through markup', () => {
    expect(noted('A *bold* claim.\n', 3, 14)).toBe(`${IMPORT}A *bold* claim#margin-note[|].\n`);
  });

  it('falls back to a point note when the selection spans paragraphs', () => {
    expect(noted('One.\n\nTwo.\n', 0, 10)).toBe(`${IMPORT}One.\n\nTwo.#margin-note[|]\n`);
  });

  it('does not wrap where the call would swallow the following text', () => {
    expect(noted('See [x] here\n', 4)).toBe('null');
    expect(noted('See [x] here\n', 0, 3)).toBe(`${IMPORT}#margin-note[See][|] [x] here\n`);
  });

  it('gives up inside code', () => {
    expect(noted('#set text(size: 12pt)\n', 16, 20)).toBe('null');
  });

  it('adds the import exactly once', () => {
    const once = `${IMPORT}Hello#margin-note[hi] world\n`;
    expect(noted(once, once.length - 1)).toBe(`${IMPORT}Hello#margin-note[hi] world#margin-note[|]\n`);
  });

  it('extends an existing drafting import, keeping its version', () => {
    const text = '#import "@preview/drafting:0.1.0": inline-note\nText\n';
    expect(noted(text, text.length - 1)).toBe('#import "@preview/drafting:0.1.0": inline-note, margin-note\nText#margin-note[|]\n');
  });

  it('extends an import list that ends with a comma', () => {
    const parens = '#import "@preview/drafting:0.2.2": (inline-note,)\nText\n';
    expect(noted(parens, parens.length - 1)).toBe('#import "@preview/drafting:0.2.2": (inline-note, margin-note)\nText#margin-note[|]\n');
    const bare = '#import "@preview/drafting:0.2.2": inline-note,\nText\n';
    expect(noted(bare, bare.length - 1)).toBe('#import "@preview/drafting:0.2.2": inline-note, margin-note\nText#margin-note[|]\n');
    const renamed = '#import "@preview/drafting:0.2.2": (a, b as c)\nText\n';
    expect(noted(renamed, renamed.length - 1)).toBe('#import "@preview/drafting:0.2.2": (a, b as c, margin-note)\nText#margin-note[|]\n');
  });

  it('adds an import at the top for a note above the existing drafting import', () => {
    const text = '= T\n#import "@preview/drafting:0.2.2": inline-note\nText\n';
    expect(noted(text, 3)).toBe(`${IMPORT}= T#margin-note[|]\n#import "@preview/drafting:0.2.2": inline-note\nText\n`);
    const full = '= T\n#import "@preview/drafting:0.2.2": margin-note\nText\n';
    expect(noted(full, 3)).toBe(`${IMPORT}= T#margin-note[|]\n#import "@preview/drafting:0.2.2": margin-note\nText\n`);
  });

  it('keeps wildcard imports and turns a bare module import into an item import', () => {
    const star = '#import "@preview/drafting:0.2.2": *\nText\n';
    expect(noted(star, star.length - 1)).toBe('#import "@preview/drafting:0.2.2": *\nText#margin-note[|]\n');
    const bare = '#import "@preview/drafting:0.2.2"\nText\n';
    expect(noted(bare, bare.length - 1)).toBe('#import "@preview/drafting:0.2.2": margin-note\nText#margin-note[|]\n');
  });

  it('adds its own import next to a renamed module import', () => {
    const text = '#import "@preview/drafting:0.2.2" as d\nText\n';
    expect(noted(text, text.length - 1)).toBe(`${IMPORT}#import "@preview/drafting:0.2.2" as d\nText#margin-note[|]\n`);
  });

  it('works at the very start of an empty document', () => {
    expect(noted('', 0)).toBe(`${IMPORT}#margin-note[|]`);
    expect(noted('Hi', 0, 2)).toBe(`${IMPORT}#margin-note[Hi][|]`);
  });
});
