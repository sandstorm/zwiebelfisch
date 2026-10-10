// Tests for without-notes.ts.
import { describe, expect, it } from 'vitest';
import { withoutNotes } from './without-notes';

const IMPORT = '#import "@preview/drafting:0.2.2": margin-note\n';

/** The main file's text in the export without comments. */
function stripped(text: string): string {
  const entry = withoutNotes({ '/main.typ': text }, '/main.typ');
  return entry.sources['/main.typ'] ?? text;
}

describe('withoutNotes', () => {
  it('drops point notes and keeps the text of range notes, without their highlight', () => {
    expect(stripped(`${IMPORT}Some text#margin-note[Is this right?] and #margin-note[*a* range][the note] here.\n`)).toBe(
      `${IMPORT}Some text and *a* range here.\n`,
    );
  });

  it('handles named arguments, threads and notes nested in a range note\'s text', () => {
    const thread = '- *Ann* (2026-10-10): Why?\n- *Bob* (2026-10-11): Because.';
    expect(stripped(`A #margin-note(side: left)[outer #margin-note[inner][x] text][${thread}] B #margin-note[in #margin-note[y] note]\n`)).toBe(
      'A outer inner text B \n',
    );
  });

  it('removes the line of a point note that stands alone, so no paragraph break appears', () => {
    expect(stripped('First line\n  #margin-note[alone]\nsecond line\n')).toBe('First line\nsecond line\n');
  });

  it('leaves calls alone that are not notes, and files without notes', () => {
    const text = '#let note = margin-note.with(side: left)\n#note[kept]\n#margin-note[a][b][c]\n';
    expect(withoutNotes({ '/main.typ': text }, '/main.typ')).toEqual({ main: '/main.typ', sources: {} });
  });

  it('compiles a wrapper that hides every remaining note, when the project uses drafting', () => {
    const files = {
      '/main.typ': '#include "chapters/one.typ"\n',
      '/chapters/one.typ': '#import "@preview/drafting:0.3.0": margin-note\nText#margin-note[n]\n',
      '/logo.png': new Uint8Array([1]),
    };
    const entry = withoutNotes(files, '/main.typ');
    expect(entry.sources['/chapters/one.typ']).toBe('#import "@preview/drafting:0.3.0": margin-note\nText\n');
    expect(entry.main).not.toBe('/main.typ');
    expect(files).not.toHaveProperty(entry.main);
    expect(entry.sources[entry.main]).toBe(
      [
        '#import "@preview/drafting:0.3.0": set-margin-note-defaults',
        '#set-margin-note-defaults(hidden: true)',
        '#include "/main.typ"',
        '',
      ].join('\n'),
    );
  });

  it('picks a wrapper path the project does not use', () => {
    const files = { '/main.typ': IMPORT };
    const first = withoutNotes(files, '/main.typ').main;
    expect(withoutNotes({ ...files, [first]: 'mine' }, '/main.typ').main).not.toBe(first);
  });
});
