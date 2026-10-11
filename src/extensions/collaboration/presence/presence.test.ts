// Tests for presence.ts.
import { describe, expect, it } from 'vitest';
import { ProjectPath } from '../../../core/paths/paths';
import { SourceOffset, TypstDocument } from '../../../core/typst-document/typst-document';
import { initials, Presences } from './presence';

describe('Presences', () => {
  it("gives each document the places in its file, and tells when they change", () => {
    const main = new TypstDocument('');
    const loose = new TypstDocument('');
    const presences = new Presences((document) => (document === main ? ProjectPath.of('/main.typ') : undefined));
    let changes = 0;
    presences.onDidChange(() => changes++);
    const ann = { id: '1', user: { name: 'Ann', color: '#b58900' }, anchor: SourceOffset.of(1), head: SourceOffset.of(2) };
    presences.set([{ ...ann, path: ProjectPath.of('/main.typ') }, { ...ann, id: '2', path: ProjectPath.of('/a.typ') }]);
    expect(changes).toBe(1);
    expect(presences.presencesIn(main).map((p) => p.id)).toEqual(['1']);
    expect(presences.presencesIn(loose)).toEqual([]);
    expect(presences.presencesAt(ProjectPath.of('/a.typ')).map((p) => p.id)).toEqual(['2']);
  });
});

describe('initials', () => {
  it('shortens names to at most two initials', () => {
    expect(initials('Ann')).toBe('A');
    expect(initials('ann lee')).toBe('AL');
    expect(initials('  Bob  van  Dam ')).toBe('BV');
    expect(initials('')).toBe('?');
  });
});
