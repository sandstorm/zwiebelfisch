// Tests for typst-syntax.ts: calculateImportChange, importedNames.
import { describe, expect, it } from 'vitest';
import { SourceOffset } from '../typst-document/typst-document';
import { calculateImportChange, importedNames } from './typst-syntax';

const apply = (text: string, change: { from: number; to: number; insert: string } | null) =>
  change ? text.slice(0, change.from) + change.insert + text.slice(change.to) : text;

const note = { name: 'note', matches: (module: string) => module === 'styles.typ', create: () => '#import "styles.typ": note\n' };

describe('calculateImportChange', () => {
  it('adds an import at the top when there is none', () => {
    expect(apply('= Doc\n', calculateImportChange('= Doc\n', note))).toBe('#import "styles.typ": note\n= Doc\n');
  });

  it('extends the import of the module, also one ending with a comma or a bare one', () => {
    expect(apply('#import "styles.typ": key\n', calculateImportChange('#import "styles.typ": key\n', note))).toBe('#import "styles.typ": key, note\n');
    expect(apply('#import "styles.typ": key,\n', calculateImportChange('#import "styles.typ": key,\n', note))).toBe('#import "styles.typ": key, note\n');
    expect(apply('#import "styles.typ"\n', calculateImportChange('#import "styles.typ"\n', note))).toBe('#import "styles.typ": note\n');
  });

  it('changes nothing when the name is imported already (or with *)', () => {
    expect(calculateImportChange('#import "styles.typ": key, note\n', note)).toBeNull();
    expect(calculateImportChange('#import "styles.typ": *\n', note)).toBeNull();
  });

  it('leaves imports of other modules alone, and counts only imports before the use', () => {
    const text = '#import "other.typ": note\n#note[x]\n#import "styles.typ": key\n';
    expect(apply(text, calculateImportChange(text, { ...note, use: SourceOffset.of(text.indexOf('#note')) }))).toBe(`#import "styles.typ": note\n${text}`);
  });
});

describe('importedNames', () => {
  it('lists the names the item lists bind, renamed ones by their new name, and star imports', () => {
    const text = '#import "a.ic.gen.typ": sheets as a-sheets, values\n#import "b.typ": *\n#import "c.typ"\n#import "@preview/merman:0.4.0": mermaid\n';
    expect(importedNames(text)).toEqual([
      { module: 'a.ic.gen.typ', name: 'sheets', binding: 'a-sheets' },
      { module: 'a.ic.gen.typ', name: 'values', binding: 'values' },
      { module: 'b.typ', name: '*', binding: '*' },
      { module: '@preview/merman:0.4.0', name: 'mermaid', binding: 'mermaid' },
    ]);
  });

  it('counts only imports ending before the use', () => {
    const text = '#import "a.typ": x\nText\n#import "b.typ": y\n';
    expect(importedNames(text, SourceOffset.of(text.indexOf('Text'))).map((n) => n.binding)).toEqual(['x']);
  });
});
