// Tests for alignment.ts.
import { describe, expect, it } from 'vitest';
import { alignArgs, setRules, withHorizontal } from './alignment';

describe('Typst alignment syntax', () => {
  it('reads the horizontal part of an alignment argument', () => {
    expect(alignArgs('center')).toEqual({ horizontal: 'center', vertical: false });
    expect(alignArgs(' right ')).toEqual({ horizontal: 'right', vertical: false });
    expect(alignArgs('top + center')).toEqual({ horizontal: 'center', vertical: true });
    expect(alignArgs('center+bottom')).toEqual({ horizontal: 'center', vertical: true });
    expect(alignArgs('horizon')).toEqual({ horizontal: null, vertical: true });
    expect(alignArgs('start')).toEqual({ horizontal: 'left', vertical: false });
    expect(alignArgs('end')).toEqual({ horizontal: 'right', vertical: false });
  });

  it('rejects anything but literal alignments', () => {
    for (const args of ['', 'x', 'center + right', 'top + bottom', 'center, top', 'alignment: center', 'center + ']) {
      expect(alignArgs(args)).toBeNull();
    }
  });

  it('replaces only the horizontal part', () => {
    expect(withHorizontal('center', 'right')).toBe('right');
    expect(withHorizontal('top + center', 'left')).toBe('top + left');
    expect(withHorizontal('start', 'center')).toBe('center');
    expect(withHorizontal('horizon', 'right')).toBe('horizon + right');
  });

  it('finds document-wide set rules for alignment and justification', () => {
    expect(setRules('#set page(margin: 2cm)')).toEqual({});
    expect(setRules('#set align(center)')).toEqual({ horizontal: 'center' });
    expect(setRules('#set par(justify: true, leading: 0.5em)')).toEqual({ justify: true });
    expect(setRules('#set align(right)\n#set text(lang: "de")\n#set align(start)\n#set par(justify: false)')).toEqual({
      horizontal: 'left',
      justify: false,
    });
    expect(setRules('#set align(horizon)')).toEqual({});
    expect(setRules('// #set align(center)')).toEqual({});
  });
});
