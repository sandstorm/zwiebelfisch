// Tests for find-notes.ts.
import { describe, expect, it } from 'vitest';
import { findNotes } from './find-notes';

describe('findNotes', () => {
  it('finds point and range notes with their messages and where the note starts', () => {
    const text = [
      'Cold #margin-note[grows][- *Ada* (2026-10-10): Linear?',
      '- *Grace* (2026-10-11): Yes.] with pages.',
      'Here #margin-note[Check this].',
      '#margin-note[]',
    ].join('\n');
    const notes = findNotes(text);
    expect(notes.map(({ messages }) => messages.map(({ author, text }) => `${author}: ${text}`))).toEqual([
      ['Ada: Linear?', 'Grace: Yes.'],
      ['null: Check this'],
    ]);
    expect(notes.map(({ at }) => text.slice(at, at + 5))).toEqual(['- *Ad', 'Check']);
  });
});
