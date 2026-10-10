// Tests for note-list.ts.
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import { findNotes, followNotes, noteAtOffset, noteAtSelection, removeNote, setNoteText, type KeyedNote } from './note-list';
import { print } from '../../../../hosts/projection/projection';
import { after, project as projectWith, schemaWith } from '../../../../testing/testing';
import { marginNotes } from '../margin-notes';

const schema = schemaWith({ contributions: [marginNotes()] });
const project = (source: string) => projectWith(source, schema);

const SOURCE = 'A #margin-note[key claim][first] and b#margin-note[second].\n\n#margin-note[#margin-note[x][inner]][outer] y\n';

function keyed(doc = project(SOURCE)): KeyedNote[] {
  let n = 0;
  return followNotes([], { map: (p: number) => p }, findNotes(doc), () => `k${n++}`);
}

describe('findNotes', () => {
  it('lists point and range notes in document order, outer before inner', () => {
    const notes = findNotes(project(SOURCE));
    expect(notes.map(({ kind, note, text }) => [kind, note, text])).toEqual([
      ['range', 'first', 'key claim'],
      ['point', 'second', ''],
      ['range', 'outer', 'x'],
      ['range', 'inner', 'x'],
    ]);
  });
});

describe('followNotes', () => {
  it('keeps the keys of notes when text before them changes', () => {
    const before = keyed();
    const state = EditorState.create({ doc: project(SOURCE) });
    const tr = state.tr.insertText('XX', 1);
    const next = followNotes(before, tr.mapping, findNotes(tr.doc), () => 'new');
    expect(next.map((n) => n.key)).toEqual(['k0', 'k1', 'k2', 'k3']);
    expect(next[0].from).toBe(before[0].from + 2);
  });

  it('keeps the key of a range note whose text changes at one end', () => {
    const before = keyed();
    const state = EditorState.create({ doc: project(SOURCE) });
    const end = after(state.doc, 'key claim');
    const tr = state.tr.delete(end - 5, end); // "claim"
    const next = followNotes(before, tr.mapping, findNotes(tr.doc), () => 'new');
    expect(next.map((n) => [n.key, n.text])).toEqual([['k0', 'key '], ['k1', ''], ['k2', 'x'], ['k3', 'x']]);
  });

  it('gives a new note a new key and drops removed ones', () => {
    const before = keyed();
    const state = EditorState.create({ doc: project(SOURCE) });
    const point = before[1];
    const tr = state.tr.delete(point.from, point.to).insert(1, state.schema.nodes.marginNote.create({ note: 'added' }));
    const next = followNotes(before, tr.mapping, findNotes(tr.doc), () => 'new');
    expect(next.map((n) => [n.key, n.note])).toEqual([['new', 'added'], ['k0', 'first'], ['k2', 'outer'], ['k3', 'inner']]);
  });
});

describe('note edits', () => {
  const edited = (change: (state: EditorState, notes: KeyedNote[]) => EditorState['tr']) => {
    const state = EditorState.create({ doc: project(SOURCE) });
    return print(state.apply(change(state, keyed(state.doc))).doc);
  };

  it('setNoteText changes only the note of a point or range note', () => {
    expect(edited((s, notes) => setNoteText(s.tr, notes[1], 'new'))).toBe(SOURCE.replace('[second]', '[new]'));
    expect(edited((s, notes) => setNoteText(s.tr, notes[0], 'new'))).toBe(SOURCE.replace('[first]', '[new]'));
    expect(edited((s, notes) => setNoteText(s.tr, notes[3], 'new'))).toBe(SOURCE.replace('[inner]', '[new]'));
  });

  it('removeNote drops a point note, and a range note\'s call but not its text', () => {
    expect(edited((s, notes) => removeNote(s.tr, notes[1]))).toBe(SOURCE.replace('#margin-note[second]', ''));
    expect(edited((s, notes) => removeNote(s.tr, notes[0]))).toBe(SOURCE.replace('#margin-note[key claim][first]', 'key claim'));
    expect(edited((s, notes) => removeNote(s.tr, notes[2]))).toBe(SOURCE.replace('#margin-note[#margin-note[x][inner]][outer]', '#margin-note[x][inner]'));
  });
});

describe('finding a note', () => {
  it('noteAtSelection: the innermost range note around the cursor, or a selected point note', () => {
    const doc = project(SOURCE);
    const notes = keyed(doc);
    expect(noteAtSelection(notes, TextSelection.create(doc, after(doc, 'key')))?.note).toBe('first');
    expect(noteAtSelection(notes, TextSelection.create(doc, after(doc, 'x') - 1))?.note).toBe('inner');
    expect(noteAtSelection(notes, NodeSelection.create(doc, notes[1].from))?.note).toBe('second');
    expect(noteAtSelection(notes, TextSelection.create(doc, after(doc, ' y')))).toBeUndefined();
  });

  it('noteAtOffset: the note whose source holds the offset', () => {
    const doc = project(SOURCE);
    const notes = keyed(doc);
    expect(noteAtOffset(notes, doc, SOURCE.indexOf('first'))?.key).toBe('k0');
    expect(noteAtOffset(notes, doc, SOURCE.indexOf('second'))?.key).toBe('k1');
    expect(noteAtOffset(notes, doc, SOURCE.indexOf('inner'))?.key).toBe('k3');
    expect(noteAtOffset(notes, doc, SOURCE.indexOf('outer'))?.key).toBe('k2');
    expect(noteAtOffset(notes, doc, 0)).toBeUndefined();
  });
});
